import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { DeleteMessageBatchCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createQueue, isQueueState, registerTriggers } from '@ez4/aws-queue';
import { Client } from '@ez4/aws-queue/client';
import { SchemaType } from '@ez4/schema';
import { deploy } from '@ez4/aws-common';
import { Runtime } from '@ez4/common';

type TestMessage = {
  id: string;
  group: string;
  text?: string;
};

const messageSchema = {
  type: SchemaType.Object,
  properties: {
    id: {
      type: SchemaType.String
    },
    group: {
      type: SchemaType.String
    },
    text: {
      type: SchemaType.String,
      optional: true
    }
  }
} as const;

// SQS counts each message as its body plus the name, type and value of each attribute (here only the trace id).
const TRACE_ATTRIBUTE_SIZE = 'EZ4.TRACE_ID'.length + 'String'.length + 36;

const sqsClient = new SQSClient();

// Received messages are deleted right away: a fifo queue holds the rest of a group while one is in flight.
const receiveAll = async (queueUrl: string, count: number) => {
  const received: TestMessage[] = [];

  for (let attempt = 0; attempt < 20 && received.length < count; attempt++) {
    const { Messages = [] } = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 5
      })
    );

    if (!Messages.length) {
      continue;
    }

    received.push(...Messages.map(({ Body }) => JSON.parse(Body!)));

    await sqsClient.send(
      new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: Messages.map(({ ReceiptHandle }, index) => ({ Id: `${index}`, ReceiptHandle }))
      })
    );
  }

  return received;
};

describe('queue client send messages', { timeout: 180000 }, () => {
  let lastState: EntryStates | undefined;

  let standardUrl: string;
  let fifoUrl: string;

  let standardClient: ReturnType<typeof Client.make<TestMessage, { fairMode: true }>>;
  let fifoClient: ReturnType<typeof Client.make<TestMessage, { fifoMode: true }>>;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const standardQueue = createQueue(localState, undefined, {
      queueName: 'ez4-test-queue-send-messages',
      fifoMode: false
    });

    const fifoQueue = createQueue(localState, undefined, {
      queueName: 'ez4-test-queue-send-messages-fifo',
      fifoMode: true
    });

    const { result } = await deploy(localState, undefined);

    const standardResult = result[standardQueue.entryId];
    const fifoResult = result[fifoQueue.entryId];

    ok(standardResult && isQueueState(standardResult) && standardResult.result);
    ok(fifoResult && isQueueState(fifoResult) && fifoResult.result);

    standardUrl = standardResult.result.queueUrl;
    fifoUrl = fifoResult.result.queueUrl;

    standardClient = Client.make(standardUrl, messageSchema);

    fifoClient = Client.make(fifoUrl, messageSchema, {
      fifoMode: {
        groupId: 'group',
        uniqueId: 'id'
      }
    });

    lastState = result;
  });

  it('assert :: every message of a standard queue arrives', async () => {
    const messages = Array.from({ length: 23 }, (_, index) => ({ id: `${index}`, group: 'standard' }));

    await standardClient.sendMessages(messages);

    const received = await receiveAll(standardUrl, messages.length);

    deepEqual(
      received.map(({ id }) => Number(id)).sort((a, b) => a - b),
      messages.map(({ id }) => Number(id))
    );
  });

  it('assert :: a request of exactly 1 MiB is accepted', async () => {
    // The JSON body is `{"id":"a","group":"edge","text":"..."}`, 35 bytes around the text.
    const textSize = 1048576 / 2 - TRACE_ATTRIBUTE_SIZE - 35;

    const messages = ['a', 'b'].map((id) => ({ id, group: 'edge', text: 'x'.repeat(textSize) }));

    await Runtime.runWithScope(async () => {
      Runtime.setScope({ traceId: 't'.repeat(36) });

      await standardClient.sendMessages(messages);
    });

    const received = await receiveAll(standardUrl, 2);

    deepEqual(received.map(({ id }) => id).sort(), ['a', 'b']);
  });

  it('assert :: a fifo group keeps the order of the list', async () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({ id: `${index}`, group: 'fifo' }));

    await fifoClient.sendMessages(messages);

    const received = await receiveAll(fifoUrl, messages.length);

    equal(received.length, messages.length);

    deepEqual(
      received.map(({ id }) => id),
      messages.map(({ id }) => id)
    );
  });

  it('assert :: destroy', async () => {
    ok(lastState);

    const { result } = await deploy(undefined, lastState);

    deepEqual(result, {});
  });
});
