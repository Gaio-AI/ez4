import type {
  SQSClient,
  ReceiveMessageCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
  SendMessageRequest,
  MessageAttributeValue
} from '@aws-sdk/client-sqs';
import type { Queue, ReceiveOptions, SendOptions, Client as SqsClient } from '@ez4/queue';
import type { MessageSchema, SendMessageFailure } from '@ez4/queue/utils';
import type { AnyObject } from '@ez4/utils';

import { MissingMessageGroupError, SendMessagesError, getJsonMessage, getJsonStringMessage } from '@ez4/queue/utils';
import { Tasks, getRandomUUID } from '@ez4/utils';
import { Runtime } from '@ez4/common';

type SqsCache = {
  sqsClient: SQSClient;
  ReceiveMessageCommand: typeof ReceiveMessageCommand;
  SendMessageCommand: typeof SendMessageCommand;
  SendMessageBatchCommand: typeof SendMessageBatchCommand;
};

type BatchEntry<T> = {
  index: number;
  message: T;
  entry: SendMessageBatchRequestEntry;
  size: number;
};

// SQS takes up to 10 messages in a request, with up to 1 MiB of them in total.
const MAX_BATCH_ENTRIES = 10;
const MAX_BATCH_SIZE = 1048576;

// Requests of a standard queue in flight at once. A fifo queue sends one at a time, so each group keeps its order.
const MAX_BATCH_REQUESTS = 10;

let SQS_CACHE: Promise<SqsCache> | undefined;

export namespace Client {
  export type Parameters<T extends Queue.Message> = {
    fifoMode?: Queue.FifoMode<T>;
    fairMode?: Queue.FairMode<T>;
  };

  export const make = <T extends Queue.Message, U extends Queue.Mode>(
    queueUrl: string,
    messageSchema: MessageSchema,
    parameters?: Parameters<T>
  ): SqsClient<T, U> => {
    const getGroupParameters = (message: T) => {
      return {
        ...(parameters?.fifoMode && getFifoParameters(message, parameters.fifoMode)),
        ...(parameters?.fairMode && getFairParameters(message, parameters.fairMode))
      };
    };

    const sendBatch = async (batch: BatchEntry<T>[], retryServerFaults: boolean): Promise<SendMessageFailure<T>[]> => {
      try {
        const { sqsClient, SendMessageBatchCommand } = await getSqsClient();

        const { Failed = [] } = await sqsClient.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: batch.map(({ entry }) => entry)
          })
        );

        const failedEntries = new Map(Failed.map((failedEntry) => [failedEntry.Id, failedEntry]));

        const failures: SendMessageFailure<T>[] = [];
        const retryBatch: BatchEntry<T>[] = [];

        for (const batchEntry of batch) {
          const failedEntry = failedEntries.get(batchEntry.entry.Id);

          if (!failedEntry) {
            continue;
          }

          // The SDK retries a request that fails as a whole; a message that failed on the side of SQS goes once more.
          if (retryServerFaults && !failedEntry.SenderFault) {
            retryBatch.push(batchEntry);
            continue;
          }

          const reason = [failedEntry.Code, failedEntry.Message].filter(Boolean).join(': ');

          failures.push({ index: batchEntry.index, message: batchEntry.message, error: new Error(reason) });
        }

        if (retryBatch.length) {
          failures.push(...(await sendBatch(retryBatch, false)));
        }

        return failures;
        //
      } catch (error) {
        return batch.map(({ index, message }) => ({ index, message, error: getError(error) }));
      }
    };

    return new (class {
      async sendMessage(message: T, options?: SendOptions<U>) {
        const [messageBody, { sqsClient, SendMessageCommand }] = await Promise.all([
          getJsonStringMessage(message, messageSchema),
          getSqsClient()
        ]);

        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            DelaySeconds: options?.delay,
            MessageBody: messageBody,
            ...getGroupParameters(message),
            MessageAttributes: getMessageAttributes()
          })
        );
      }

      async sendMessages(messages: T[], options?: SendOptions<U>) {
        // Taken before anything else, callers import the scope right before sending.
        const messageAttributes = getMessageAttributes();
        const attributesSize = getAttributesSize(messageAttributes);

        const failures: SendMessageFailure<T>[] = [];

        const batchEntries = await Promise.all(
          messages.map(async (message, index): Promise<BatchEntry<T> | undefined> => {
            try {
              const messageBody = await getJsonStringMessage(message, messageSchema);

              const entry = {
                Id: `${index}`,
                DelaySeconds: options?.delay,
                MessageBody: messageBody,
                ...getGroupParameters(message),
                MessageAttributes: messageAttributes
              };

              return { index, message, entry, size: Buffer.byteLength(messageBody) + attributesSize };
              //
            } catch (error) {
              failures.push({ index, message, error: getError(error) });

              return undefined;
            }
          })
        );

        const batchFailures = await Tasks.run(
          getBatches(batchEntries.filter((batchEntry) => batchEntry !== undefined)).map((batch) => {
            return () => sendBatch(batch, true);
          }),
          {
            concurrency: parameters?.fifoMode ? 1 : MAX_BATCH_REQUESTS
          }
        );

        failures.push(...batchFailures.flat());

        if (failures.length) {
          throw new SendMessagesError(
            failures.sort((a, b) => a.index - b.index),
            messages.length
          );
        }
      }

      async receiveMessage(options?: ReceiveOptions): Promise<T[]> {
        const { sqsClient, ReceiveMessageCommand } = await getSqsClient();

        const response = await sqsClient.send(
          new ReceiveMessageCommand({
            MaxNumberOfMessages: options?.messages,
            WaitTimeSeconds: options?.polling,
            QueueUrl: queueUrl
          })
        );

        const safeMessages = response.Messages!.map(({ Body }) => {
          return getJsonMessage(JSON.parse(Body!), messageSchema);
        });

        return Promise.all(safeMessages);
      }
    })();
  };
}

const getFairParameters = <T extends Queue.Message>(
  message: AnyObject,
  fairMode: Queue.FairMode<T>
): Pick<SendMessageRequest, 'MessageGroupId'> => {
  const { groupId } = fairMode;

  const groupIdValue = message[groupId];

  if (!groupIdValue) {
    throw new MissingMessageGroupError(groupId.toString());
  }

  return {
    MessageGroupId: `${groupIdValue}`
  };
};

const getFifoParameters = <T extends Queue.Message>(
  message: AnyObject,
  fifoMode: Queue.FifoMode<T>
): Pick<SendMessageRequest, 'MessageGroupId' | 'MessageDeduplicationId'> => {
  const { uniqueId } = fifoMode;

  const uniqueIdValue = uniqueId && message[uniqueId];

  return {
    ...getFairParameters(message, fifoMode),
    ...(uniqueIdValue && {
      MessageDeduplicationId: `${uniqueIdValue}`
    })
  };
};

const getMessageAttributes = (): Record<string, MessageAttributeValue> => {
  const traceId = Runtime.getScope()?.traceId ?? getRandomUUID();
  const scope = Runtime.exportScope();

  return {
    ['EZ4.TRACE_ID']: {
      StringValue: traceId,
      DataType: 'String'
    },
    ...(scope !== undefined && {
      ['EZ4.SCOPE']: {
        StringValue: scope,
        DataType: 'String'
      }
    })
  };
};

// SQS counts the name, the data type and the value of each message attribute in the message size.
const getAttributesSize = (attributes: Record<string, MessageAttributeValue>) => {
  return Object.entries(attributes).reduce((total, [name, { DataType, StringValue }]) => {
    return total + Buffer.byteLength(name) + Buffer.byteLength(DataType ?? '') + Buffer.byteLength(StringValue ?? '');
  }, 0);
};

const getBatches = <T>(batchEntries: BatchEntry<T>[]) => {
  const batches: BatchEntry<T>[][] = [];

  let currentBatch: BatchEntry<T>[] = [];
  let currentSize = 0;

  for (const batchEntry of batchEntries) {
    const isBatchFull = currentBatch.length === MAX_BATCH_ENTRIES || currentSize + batchEntry.size > MAX_BATCH_SIZE;

    // A message bigger than a whole batch still goes alone, so SQS refuses it with its own reason.
    if (isBatchFull && currentBatch.length) {
      batches.push(currentBatch);

      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(batchEntry);
    currentSize += batchEntry.size;
  }

  if (currentBatch.length) {
    batches.push(currentBatch);
  }

  return batches;
};

const getError = (error: unknown) => {
  return error instanceof Error ? error : new Error(`${error}`);
};

const getSqsClient = async () => {
  if (!SQS_CACHE) {
    SQS_CACHE = import('@aws-sdk/client-sqs')
      .then(({ SQSClient, ReceiveMessageCommand, SendMessageCommand, SendMessageBatchCommand }) => {
        return {
          sqsClient: new SQSClient(),
          ReceiveMessageCommand,
          SendMessageCommand,
          SendMessageBatchCommand
        };
      })
      .catch((error) => {
        SQS_CACHE = undefined;
        throw error;
      });
  }

  return SQS_CACHE;
};
