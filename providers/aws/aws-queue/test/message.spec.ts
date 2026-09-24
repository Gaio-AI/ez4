import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import type { ObjectSchema } from '@ez4/schema';
import type { Queue } from '@ez4/queue';

import { describe, it, before, beforeEach, afterEach, after, mock } from 'node:test';
import { deepEqual, rejects } from 'node:assert/strict';

import { ChangeMessageVisibilityCommand, DeleteMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ServiceEventType } from '@ez4/common';
import { SchemaType } from '@ez4/schema';

import { sqsEntryPoint } from '../lib/message';

const messageSchema: ObjectSchema = {
  type: SchemaType.Object,
  properties: {
    id: {
      type: SchemaType.String
    }
  }
};

const sentCommands: string[] = [];
const handledMessages: string[] = [];
const failingMessages = new Set<string>();
const retryingMessages = new Set<string>();

let failingEvent: ServiceEventType | undefined;

// Stand-ins for what the bundler defines around lib/message.ts in a deployed function.
const runtime = globalThis as Record<string, unknown>;

// Equal backoff bounds make the retry delay deterministic.
const runtimeGlobals = {
  __EZ4_SCHEMA: messageSchema,
  __EZ4_MAX_ATTEMPTS: 5,
  __EZ4_MIN_BACKOFF: 5,
  __EZ4_MAX_BACKOFF: 5,
  __EZ4_CONTEXT: {},
  handle: async (request: Queue.Incoming<{ id: string }>) => {
    const { id } = request.message;

    handledMessages.push(id);

    if (failingMessages.has(id)) {
      throw new Error(`Handler failed for ${id}.`);
    }

    if (retryingMessages.has(id)) {
      await request.retry({ delay: 30 });
    }
  },
  dispatch: async (event: { type: ServiceEventType }) => {
    if (event.type === failingEvent) {
      throw new Error(`Listener failed on ${event.type}.`);
    }
  }
};

const context = {
  awsRequestId: 'request-id',
  getRemainingTimeInMillis: () => 30_000
} as Context;

const makeRecord = (id: string, groupId?: string): SQSRecord => {
  return {
    messageId: `message-${id}`,
    receiptHandle: `receipt-${id}`,
    body: JSON.stringify({ id }),
    attributes: {
      ApproximateReceiveCount: '1',
      ApproximateFirstReceiveTimestamp: '0',
      SentTimestamp: '0',
      SenderId: 'sender',
      ...(groupId && {
        MessageGroupId: groupId
      })
    },
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
    awsRegion: 'us-east-1'
  };
};

const makeEvent = (...records: SQSRecord[]): SQSEvent => {
  return {
    Records: records
  };
};

describe('aws queue message handler', () => {
  before(() => {
    Object.assign(runtime, runtimeGlobals);
  });

  beforeEach(() => {
    sentCommands.length = 0;
    handledMessages.length = 0;
    failingMessages.clear();
    retryingMessages.clear();
    failingEvent = undefined;

    mock.method(SQSClient.prototype, 'send', async (command: unknown) => {
      if (command instanceof DeleteMessageCommand) {
        sentCommands.push(`delete ${command.input.ReceiptHandle}`);
      } else if (command instanceof ChangeMessageVisibilityCommand) {
        sentCommands.push(`visibility ${command.input.ReceiptHandle} ${command.input.VisibilityTimeout}`);
      }

      return {};
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  after(() => {
    for (const name of Object.keys(runtimeGlobals)) {
      delete runtime[name];
    }
  });

  it('assert :: a single record is left for the event source mapping to delete', async () => {
    const response = await sqsEntryPoint(makeEvent(makeRecord('a')), context);

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(handledMessages, ['a']);
    deepEqual(sentCommands, []);
  });

  it('assert :: a longer batch deletes each record as soon as it is handled', async () => {
    const response = await sqsEntryPoint(makeEvent(makeRecord('a'), makeRecord('b')), context);

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(handledMessages, ['a', 'b']);
    deepEqual(sentCommands, ['delete receipt-a', 'delete receipt-b']);
  });

  it('assert :: a failed record is delayed and reported', async () => {
    failingMessages.add('a');

    const response = await sqsEntryPoint(makeEvent(makeRecord('a')), context);

    deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'message-a' }] });
    deepEqual(sentCommands, ['visibility receipt-a 5']);
  });

  it('assert :: a record the handler retries is reported and not deleted', async () => {
    retryingMessages.add('a');

    const response = await sqsEntryPoint(makeEvent(makeRecord('a'), makeRecord('b')), context);

    deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'message-a' }] });
    deepEqual(sentCommands, ['visibility receipt-a 30', 'delete receipt-b']);
  });

  it('assert :: a record already handled is not sent back when a later hook fails', async () => {
    failingEvent = ServiceEventType.Done;

    const response = await sqsEntryPoint(makeEvent(makeRecord('a')), context);

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(handledMessages, ['a']);
    deepEqual(sentCommands, []);
  });

  it('assert :: a failed record holds back the rest of its group', async () => {
    failingMessages.add('a');

    const event = makeEvent(makeRecord('a', 'group-1'), makeRecord('b', 'group-1'), makeRecord('c', 'group-2'));

    const response = await sqsEntryPoint(event, context);

    deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'message-a' }, { itemIdentifier: 'message-b' }] });
    deepEqual(handledMessages, ['a', 'c']);
    deepEqual(sentCommands, ['visibility receipt-a 5', 'delete receipt-c']);
  });

  it('assert :: an error before the records fails the invocation', async () => {
    failingEvent = ServiceEventType.Begin;

    await rejects(() => sqsEntryPoint(makeEvent(makeRecord('a')), context), /Listener failed on begin/);

    deepEqual(handledMessages, []);
  });
});
