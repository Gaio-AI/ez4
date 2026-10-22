import type { SQSEvent, Context, SQSBatchItemFailure, SQSBatchResponse, SQSRecord } from 'aws-lambda';
import type { ValidationCustomContext } from '@ez4/validator';
import type { MessageSchema } from '@ez4/queue/utils';
import type { Queue } from '@ez4/queue';
import type { AttributeValue, DynamoDBClient, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';

import { SQSClient, DeleteMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import { getIdempotencyKey, getJsonMessage, isUnknownOutcomeError, resolveValidation } from '@ez4/queue/utils';
import { ServiceEventType, Runtime } from '@ez4/common';
import { getRandomInteger, getRandomUUID, Tasks, Wait } from '@ez4/utils';

type ClaimsOptions = {
  tableName: string;
  handlerName: string;
  key: string[];
  ttl: number;
  lease: number;
  keyAttribute: string;
  expirationAttribute: string;
};

type HeldClaim = {
  key: string;
  owner: string;
};

const client = new SQSClient({});

declare const __EZ4_SCHEMA: MessageSchema | null;
declare const __EZ4_MAX_ATTEMPTS: number;
declare const __EZ4_MIN_BACKOFF: number;
declare const __EZ4_MAX_BACKOFF: number;
declare const __EZ4_RETRY_WINDOW: number;
declare const __EZ4_PARALLELISM: number;
declare const __EZ4_ACKNOWLEDGE: 'record' | 'batch';
declare const __EZ4_IDEMPOTENCY: ClaimsOptions | null;
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
  // not run again. A batch acknowledge leaves every delete to the event source mapping, which takes
  // them in batches instead of one request per record, and accepts that what already ran runs again
  // when the invocation dies.
  const deleteEachRecord = __EZ4_ACKNOWLEDGE !== 'batch' && records.length > 1;

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
    let heldClaim: HeldClaim | undefined;
    let handled = false;

    try {
      const payload = JSON.parse(record.body);
      const message = await getJsonMessage(payload, schema, onCustomValidation);

      if (__EZ4_IDEMPOTENCY) {
        const claimKey = getIdempotencyKey(__EZ4_IDEMPOTENCY.handlerName, message, __EZ4_IDEMPOTENCY.key);
        const claimResult = await takeClaim(__EZ4_IDEMPOTENCY, claimKey);

        if (claimResult.status === 'done') {
          console.info({ messageId: record.messageId, claimKey, claimStatus: claimResult.status });

          if (deleteEachRecord) {
            await ackMessage(record);
          }

          return outcome;
        }

        if (claimResult.status === 'busy') {
          console.info({ messageId: record.messageId, claimKey, claimStatus: claimResult.status });

          outcome.handedBack = true;
          outcome.holdsGroup = true;

          await retryMessage(record);

          return outcome;
        }

        heldClaim = claimResult.claim;
      }

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

      // A handler that handed its message back runs it again, so the key goes back with it.
      if (heldClaim && __EZ4_IDEMPOTENCY) {
        if (outcome.handedBack) {
          await releaseClaim(__EZ4_IDEMPOTENCY, heldClaim);
        } else {
          await keepClaim(__EZ4_IDEMPOTENCY, heldClaim, 'done');
        }
      }

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
        await failRecord(record, heldClaim, error, deleteEachRecord, outcome);
      }
    } finally {
      if (currentRequest) {
        activeRequests.delete(currentRequest);
      }
    }

    return outcome;
  });
};

const failRecord = async (
  record: SQSRecord,
  heldClaim: HeldClaim | undefined,
  error: unknown,
  deleteEachRecord: boolean,
  outcome: RecordOutcome
) => {
  if (!heldClaim || !__EZ4_IDEMPOTENCY) {
    outcome.handedBack = true;

    return retryMessage(record);
  }

  // The work may or may not have happened: the key is kept as if it ran, and the message is consumed so it runs
  // neither again nor twice.
  if (isUnknownOutcomeError(error)) {
    await keepClaim(__EZ4_IDEMPOTENCY, heldClaim, 'unknown');

    if (deleteEachRecord) {
      await ackMessage(record);
    }

    return undefined;
  }

  await releaseClaim(__EZ4_IDEMPOTENCY, heldClaim);

  outcome.handedBack = true;

  return retryMessage(record);
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

/**
 * Delay (in seconds) before the next attempt of a queue whose retries have to span the retry window.
 *
 * The first retry waits between the backoff bounds, so a passing failure is retried soon. The retries after it
 * split what is left of the window, so the last attempt only runs once the window has gone by: a dependency that
 * is down for less than the window is back before the attempts run out. Each share waits up to a quarter more, so
 * the messages of one outage don't all come back in the same second. The last attempt and any past it wait between
 * the backoff bounds as well: no retry is left to stretch, and waiting longer would only hold back the dead-letter.
 *
 * It lives in this runtime rather than in `@ez4/utils` because every function bundles that package: a change there
 * would change the bytes of every function, not only of the queue ones.
 */
const getWindowDelay = (attempt: number) => {
  const retries = __EZ4_MAX_ATTEMPTS - 1;

  const stretched = attempt <= retries && (attempt > 1 || retries === 1);

  if (!stretched) {
    return getRandomInteger(__EZ4_MIN_BACKOFF, __EZ4_MAX_BACKOFF);
  }

  const share = retries > 1 ? Math.ceil((__EZ4_RETRY_WINDOW - __EZ4_MIN_BACKOFF) / (retries - 1)) : __EZ4_RETRY_WINDOW;

  return getRandomInteger(share, Math.ceil(share * 1.25));
};

const retryMessage = async (record: SQSRecord, userDelay?: number) => {
  const { messageId, receiptHandle, attributes } = record;

  try {
    const attemptCount = Number(attributes.ApproximateReceiveCount);
    const attemptDelay = __EZ4_RETRY_WINDOW
      ? getWindowDelay(attemptCount)
      : Wait.delay(attemptCount, __EZ4_MAX_ATTEMPTS, __EZ4_MIN_BACKOFF, __EZ4_MAX_BACKOFF);

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

/**
 * - `taken`: this execution holds the key and runs the handler.
 * - `done`: the key already ran, or its outcome is unknown, so the handler doesn't run again.
 * - `busy`: another execution holds the key, so the message goes back to the queue.
 */
type ClaimResult = { status: 'taken'; claim: HeldClaim } | { status: 'done' } | { status: 'busy' };

type DynamoDbCache = {
  dynamoDbClient: DynamoDBClient;
  UpdateItemCommand: typeof UpdateItemCommand;
  DeleteItemCommand: typeof DeleteItemCommand;
};

const enum ClaimState {
  Running = 'running',
  Done = 'done',
  Unknown = 'unknown'
}

// Loaded on the first claim, so a queue function that doesn't run its messages once never loads the client.
let DYNAMODB_CACHE: Promise<DynamoDbCache> | undefined;

/**
 * Take the key for one execution of the handler. A key that's free, or whose lease or ttl has passed (the table
 * deletes expired items some time later), is taken; one that's running in another execution or that already ran
 * isn't.
 */
const takeClaim = async (options: ClaimsOptions, key: string): Promise<ClaimResult> => {
  const { dynamoDbClient, UpdateItemCommand } = await getDynamoDbClient();

  const owner = getRandomUUID();
  const now = getEpochSeconds();

  try {
    await dynamoDbClient.send(
      new UpdateItemCommand({
        TableName: options.tableName,
        Key: getClaimItemKey(options, key),
        UpdateExpression: 'SET #state = :state, #owner = :owner, #expiration = :expiration',
        ConditionExpression: 'attribute_not_exists(#key) OR #expiration <= :now',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        ExpressionAttributeNames: {
          '#key': options.keyAttribute,
          '#state': 'state',
          '#owner': 'owner',
          '#expiration': options.expirationAttribute
        },
        ExpressionAttributeValues: {
          ':state': { S: ClaimState.Running },
          ':owner': { S: owner },
          ':expiration': { N: `${now + options.lease}` },
          ':now': { N: `${now}` }
        }
      })
    );

    return { status: 'taken', claim: { key, owner } };
    //
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }

    return error.Item?.state?.S === ClaimState.Running ? { status: 'busy' } : { status: 'done' };
  }
};

/**
 * Keep the key for its ttl, as done or as unknown. The handler has already run, so a failure here is only logged:
 * the key frees itself once its lease passes, and a message delivered after that runs again.
 */
const keepClaim = async (options: ClaimsOptions, claim: HeldClaim, state: 'done' | 'unknown') => {
  try {
    const { dynamoDbClient, UpdateItemCommand } = await getDynamoDbClient();

    await dynamoDbClient.send(
      new UpdateItemCommand({
        TableName: options.tableName,
        Key: getClaimItemKey(options, claim.key),
        UpdateExpression: 'SET #state = :state, #expiration = :expiration',
        ConditionExpression: '#owner = :owner',
        ExpressionAttributeNames: {
          '#state': 'state',
          '#owner': 'owner',
          '#expiration': options.expirationAttribute
        },
        ExpressionAttributeValues: {
          ':state': { S: state === 'done' ? ClaimState.Done : ClaimState.Unknown },
          ':owner': { S: claim.owner },
          ':expiration': { N: `${getEpochSeconds() + options.ttl}` }
        }
      })
    );
  } catch (error) {
    console.warn({ error: `${error}`, claimKey: claim.key, claimState: state });
  }
};

/**
 * Free the key for the next attempt. A failure is only logged: the key frees itself once its lease passes.
 */
const releaseClaim = async (options: ClaimsOptions, claim: HeldClaim) => {
  try {
    const { dynamoDbClient, DeleteItemCommand } = await getDynamoDbClient();

    await dynamoDbClient.send(
      new DeleteItemCommand({
        TableName: options.tableName,
        Key: getClaimItemKey(options, claim.key),
        ConditionExpression: '#owner = :owner',
        ExpressionAttributeNames: {
          '#owner': 'owner'
        },
        ExpressionAttributeValues: {
          ':owner': { S: claim.owner }
        }
      })
    );
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      console.warn({ error: `${error}`, claimKey: claim.key });
    }
  }
};

const getClaimItemKey = (options: ClaimsOptions, key: string): Record<string, AttributeValue> => {
  return {
    [options.keyAttribute]: { S: key }
  };
};

const getEpochSeconds = () => {
  return Math.floor(Date.now() / 1000);
};

const isConditionalCheckFailed = (error: unknown): error is Error & { Item?: Record<string, AttributeValue> } => {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
};

const getDynamoDbClient = async () => {
  if (!DYNAMODB_CACHE) {
    DYNAMODB_CACHE = import('@aws-sdk/client-dynamodb')
      .then(({ DynamoDBClient, UpdateItemCommand, DeleteItemCommand }) => {
        return {
          dynamoDbClient: new DynamoDBClient({}),
          UpdateItemCommand,
          DeleteItemCommand
        };
      })
      .catch((error) => {
        DYNAMODB_CACHE = undefined;
        throw error;
      });
  }

  return DYNAMODB_CACHE;
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
  Runtime.reportError(error);

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
