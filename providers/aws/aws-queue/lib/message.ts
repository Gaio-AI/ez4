import type { SQSEvent, Context, SQSBatchItemFailure, SQSBatchResponse, SQSRecord } from 'aws-lambda';
import type { ValidationCustomContext } from '@ez4/validator';
import type { MessageSchema } from '@ez4/queue/utils';
import type { Queue } from '@ez4/queue';

import { SQSClient, DeleteMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import { getJsonMessage, resolveValidation } from '@ez4/queue/utils';
import { ServiceEventType, Runtime } from '@ez4/common';
import { getRandomUUID, Tasks, Wait } from '@ez4/utils';

const client = new SQSClient({});

declare const __EZ4_SCHEMA: MessageSchema | null;
declare const __EZ4_MAX_ATTEMPTS: number;
declare const __EZ4_MIN_BACKOFF: number;
declare const __EZ4_MAX_BACKOFF: number;
declare const __EZ4_PARALLELISM: number;
declare const __EZ4_CONTEXT: object;

declare function dispatch(event: Queue.ServiceEvent<Queue.Message>, context: object): Promise<void>;
declare function handle(request: Queue.Incoming<Queue.Message>, context: object): Promise<any>;

// Time kept at the end of the invocation to report a timeout before the runtime is stopped.
const TimeoutMargin = 1000;

type ActiveRecord = {
  traceId: string;
  record: SQSRecord;
};

const activeRequests = new Map<Queue.Incoming<Queue.Message>, ActiveRecord>();

/**
 * Entrypoint to handle SQS events.
 */
export async function sqsEntryPoint(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  if (!__EZ4_SCHEMA) {
    throw new Error('Validation schema for SQS message not found.');
  }

  activeRequests.clear();

  const milliseconds = Math.max(0, context.getRemainingTimeInMillis() - TimeoutMargin);
  const timeoutEvent = setTimeout(() => onTimeout(request, milliseconds), milliseconds);

  const request = {
    requestId: context.awsRequestId,
    maxAttempts: __EZ4_MAX_ATTEMPTS,
    attempt: Number.NaN
  };

  try {
    await onBegin(request);

    const batchItemFailures = await processAllRecords(request, __EZ4_SCHEMA, event.Records, context);

    return {
      batchItemFailures
    };
  } catch (error) {
    await onError(error, request);

    // Without a batch response the event source mapping takes the batch as done and deletes every
    // record, including the ones that never ran. Failing the invocation hands them back instead.
    throw error;
  } finally {
    clearTimeout(timeoutEvent);
    await onEnd(request);
  }
}

type RecordOutcome = {
  handedBack: boolean;
  holdsGroup: boolean;
};

const processAllRecords = async (
  request: Queue.Request,
  schema: MessageSchema,
  records: SQSRecord[],
  context: Context
): Promise<SQSBatchItemFailure[]> => {
  const failedMessageIds = new Set<string>();
  const failedGroupIds = new Set<string>();

  // The event source mapping deletes every record left out of the batch response, so a lone record
  // needs no delete of its own. In a longer batch each record is still deleted as soon as it's handled:
  // an invocation that dies on a later record hands the whole batch back, and what already ran must
  // not run again.
  const deleteEachRecord = records.length > 1;

  const groupTurns = new Map<string, Promise<void>>();

  // After the first records finish, a record starts only while the invocation has time left for
  // the slowest one so far.
  let slowestRecord = 0;

  // A failure the batch response can't carry fails the invocation: no other record starts, and the
  // ones in flight finish before it's thrown.
  let batchFailure: { reason: unknown } | undefined;

  const recordTasks = records.map((record) => {
    const messageGroupId = record.attributes.MessageGroupId;
    const previousInGroup = messageGroupId ? groupTurns.get(messageGroupId) : undefined;

    let endTurn = () => {};

    const turn = new Promise<void>((resolve) => {
      endTurn = resolve;
    });

    if (messageGroupId) {
      groupTurns.set(messageGroupId, turn);
    }

    return async () => {
      try {
        // Messages from the same group (FIFO queues) run in order, and once one of them fails the
        // next ones are skipped to avoid duplication.
        await previousInGroup;

        if (batchFailure) {
          return;
        }

        if (messageGroupId && failedGroupIds.has(messageGroupId)) {
          failedMessageIds.add(record.messageId);
          return;
        }

        const timeLeft = context.getRemainingTimeInMillis() - TimeoutMargin;

        if (slowestRecord > 0 && timeLeft <= slowestRecord) {
          console.warn({ messageId: record.messageId, timeLeft, slowestRecord });

          failedMessageIds.add(record.messageId);

          if (messageGroupId) {
            failedGroupIds.add(messageGroupId);
          }

          return;
        }

        const startTime = Date.now();

        const { handedBack, holdsGroup } = await processRecord(request, schema, record, deleteEachRecord);

        slowestRecord = Math.max(slowestRecord, Date.now() - startTime);

        if (handedBack) {
          failedMessageIds.add(record.messageId);
        }

        if (holdsGroup && messageGroupId) {
          failedGroupIds.add(messageGroupId);
        }
      } catch (reason) {
        batchFailure ??= { reason };
      } finally {
        endTurn();
      }
    };
  });

  // Records are taken in batch order, so a parallelism of one runs the batch one after another.
  await Tasks.run(recordTasks, {
    concurrency: Math.max(1, Math.trunc(__EZ4_PARALLELISM) || 1)
  });

  if (batchFailure) {
    throw batchFailure.reason;
  }

  return records
    .filter(({ messageId }) => failedMessageIds.has(messageId))
    .map(({ messageId }) => ({
      itemIdentifier: messageId
    }));
};

const processRecord = async (
  request: Queue.Request,
  schema: MessageSchema,
  record: SQSRecord,
  deleteEachRecord: boolean
): Promise<RecordOutcome> => {
  const traceId = record.messageAttributes['EZ4.TRACE_ID']?.stringValue ?? getRandomUUID();

  // Records run side by side, so each one keeps its own scope for what it logs and sends.
  return Runtime.runWithScope(async () => {
    importRecordScope(traceId, record);

    const outcome: RecordOutcome = {
      handedBack: false,
      holdsGroup: false
    };

    let currentRequest: Queue.Incoming<Queue.Message> | undefined;
    let handled = false;

    try {
      const payload = JSON.parse(record.body);
      const message = await getJsonMessage(payload, schema, onCustomValidation);

      const retry = async (options?: Queue.RetryOptions) => {
        outcome.handedBack = true;
        outcome.holdsGroup = true;

        await retryMessage(record, options?.delay);
      };

      currentRequest = {
        ...request,
        attempt: Number(record.attributes.ApproximateReceiveCount),
        traceId,
        message,
        retry
      };

      activeRequests.set(currentRequest, { traceId, record });

      await onReady(currentRequest);

      await handle(currentRequest, __EZ4_CONTEXT);

      handled = true;

      if (deleteEachRecord && !outcome.handedBack) {
        await ackMessage(record);
      }

      await onDone(currentRequest);
    } catch (error) {
      await onError(error, currentRequest ?? request);

      outcome.holdsGroup = true;

      // A record whose handler finished is consumed even when a hook after it fails: sending it
      // back would run it again.
      if (!handled) {
        await retryMessage(record);

        outcome.handedBack = true;
      }
    } finally {
      if (currentRequest) {
        activeRequests.delete(currentRequest);
      }
    }

    return outcome;
  });
};

const getQueueUrl = (queueArn: string): string => {
  const arnParts = queueArn.match(/^arn:aws:sqs:([^:]+):([^:]+):(.+)$/);

  if (!arnParts) {
    throw new Error('Invalid event source ARN.');
  }

  const [, region, accountId, queueName] = arnParts;

  return `https://sqs.${region}.amazonaws.com/${accountId}/${queueName}`;
};

const ackMessage = async (record: SQSRecord) => {
  const { messageId, receiptHandle } = record;

  try {
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: getQueueUrl(record.eventSourceARN),
        ReceiptHandle: receiptHandle
      })
    );
  } catch (error) {
    console.warn({
      error: `${error}`,
      receiptHandle,
      messageId
    });
  }
};

const retryMessage = async (record: SQSRecord, userDelay?: number) => {
  const { messageId, receiptHandle, attributes } = record;

  try {
    const attemptCount = Number(attributes.ApproximateReceiveCount);
    const attemptDelay = Wait.delay(attemptCount, __EZ4_MAX_ATTEMPTS, __EZ4_MIN_BACKOFF, __EZ4_MAX_BACKOFF);

    await client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: getQueueUrl(record.eventSourceARN),
        VisibilityTimeout: userDelay ?? attemptDelay,
        ReceiptHandle: receiptHandle
      })
    );
  } catch (error) {
    console.warn({
      error: `${error}`,
      receiptHandle,
      messageId
    });
  }
};

const onCustomValidation = (value: unknown, context: ValidationCustomContext) => {
  return resolveValidation(value, __EZ4_CONTEXT, context.type);
};

const onBegin = (request: Partial<Queue.Request>) => {
  return dispatch(
    {
      type: ServiceEventType.Begin,
      request
    },
    __EZ4_CONTEXT
  );
};

const onReady = (request: Partial<Queue.Incoming<Queue.Message>>) => {
  return dispatch(
    {
      type: ServiceEventType.Ready,
      request
    },
    __EZ4_CONTEXT
  );
};

const onDone = async (request: Partial<Queue.Incoming<Queue.Message>>) => {
  return dispatch(
    {
      type: ServiceEventType.Done,
      request
    },
    __EZ4_CONTEXT
  );
};

const onTimeout = async (request: Partial<Queue.Request>, timeoutAfter: number) => {
  const reportTimeout = (pendingRequest: Partial<Queue.Request | Queue.Incoming<Queue.Message>>) => {
    console.warn({ ...Runtime.getScope(), timeoutAfter });

    return dispatch(
      {
        type: ServiceEventType.Timeout,
        request: pendingRequest
      },
      __EZ4_CONTEXT
    );
  };

  if (!activeRequests.size) {
    return reportTimeout(request);
  }

  // The timer runs outside the records, so each report takes the scope of the record it's about.
  await Promise.all(
    [...activeRequests].map(([activeRequest, { traceId, record }]) => {
      return Runtime.runWithScope(() => {
        importRecordScope(traceId, record);

        return reportTimeout(activeRequest);
      });
    })
  );
};

const importRecordScope = (traceId: string, record: SQSRecord) => {
  Runtime.importScope(traceId, record.messageAttributes['EZ4.SCOPE']?.stringValue);
};

const onError = (error: unknown, request: Partial<Queue.Request | Queue.Incoming<Queue.Message>>) => {
  console.error({ ...Runtime.getScope(), error });

  return dispatch(
    {
      type: ServiceEventType.Error,
      request,
      error
    },
    __EZ4_CONTEXT
  );
};

const onEnd = (request: Partial<Queue.Request>) => {
  return dispatch(
    {
      type: ServiceEventType.End,
      request
    },
    __EZ4_CONTEXT
  );
};
