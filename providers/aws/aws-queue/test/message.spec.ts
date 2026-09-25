import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import type { ObjectSchema } from '@ez4/schema';
import type { Queue } from '@ez4/queue';

import { describe, it, before, beforeEach, afterEach, after, mock } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';

import { setTimeout } from 'node:timers/promises';

import { ChangeMessageVisibilityCommand, DeleteMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ServiceEventType, Runtime } from '@ez4/common';
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
const handlerEvents: string[] = [];
const handlerTraces: string[] = [];
const timeoutTraces: string[] = [];

let failingEvent: ServiceEventType | undefined;
let handlerDelay = 0;
let running = 0;
let maxRunning = 0;

// Stand-ins for what the bundler defines around lib/message.ts in a deployed function.
const runtime = globalThis as Record<string, unknown>;

// Equal backoff bounds make the retry delay deterministic.
const runtimeGlobals = {
  __EZ4_SCHEMA: messageSchema,
  __EZ4_MAX_ATTEMPTS: 5,
  __EZ4_MIN_BACKOFF: 5,
  __EZ4_MAX_BACKOFF: 5,
  __EZ4_PARALLELISM: 1,
  __EZ4_CONTEXT: {},
  handle: async (request: Queue.Incoming<{ id: string }>) => {
    const { id } = request.message;

    handledMessages.push(id);
    handlerEvents.push(`start ${id}`);

    running++;
    maxRunning = Math.max(maxRunning, running);

    await setTimeout(handlerDelay);

    running--;

    handlerTraces.push(`${id}:${Runtime.getScope()?.traceId}:${Runtime.getScope()?.sessionId}`);
    handlerEvents.push(`end ${id}`);

    if (failingMessages.has(id)) {
      throw new Error(`Handler failed for ${id}.`);
    }

    if (retryingMessages.has(id)) {
      await request.retry({ delay: 30 });
    }
  },
  dispatch: async (event: { type: ServiceEventType; request: Partial<Queue.Incoming<{ id: string }>> }) => {
    if (event.type === ServiceEventType.Timeout) {
      timeoutTraces.push(`${event.request.message?.id}:${Runtime.getScope()?.traceId}:${Runtime.getScope()?.sessionId}`);
    }

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
    messageAttributes: {
      'EZ4.TRACE_ID': {
        stringValue: `trace-${id}`,
        dataType: 'String',
        stringListValues: [],
        binaryListValues: []
      },
      'EZ4.SCOPE': {
        stringValue: JSON.stringify({
          values: { sessionId: `session-${id}` },
          headers: { sessionId: 'x-session-id' }
        }),
        dataType: 'String',
        stringListValues: [],
        binaryListValues: []
      }
    },
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
    handlerEvents.length = 0;
    handlerTraces.length = 0;
    timeoutTraces.length = 0;
    failingMessages.clear();
    retryingMessages.clear();
    failingEvent = undefined;
    handlerDelay = 0;
    running = 0;
    maxRunning = 0;

    runtime.__EZ4_PARALLELISM = 1;

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

  it('assert :: records run at the same time up to the parallelism', async () => {
    runtime.__EZ4_PARALLELISM = 2;
    handlerDelay = 20;

    const response = await sqsEntryPoint(makeEvent(makeRecord('a'), makeRecord('b'), makeRecord('c')), context);

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(handledMessages, ['a', 'b', 'c']);
    equal(maxRunning, 2);
  });

  it('assert :: records of one group run in order while other groups run beside them', async () => {
    runtime.__EZ4_PARALLELISM = 2;
    handlerDelay = 20;

    const event = makeEvent(makeRecord('a', 'group-1'), makeRecord('c', 'group-2'), makeRecord('b', 'group-1'));

    const response = await sqsEntryPoint(event, context);

    deepEqual(response, { batchItemFailures: [] });
    ok(handlerEvents.indexOf('start c') < handlerEvents.indexOf('end a'));
    ok(handlerEvents.indexOf('start b') > handlerEvents.indexOf('end a'));
  });

  it('assert :: each record sees its own scope', async () => {
    runtime.__EZ4_PARALLELISM = 2;
    handlerDelay = 20;

    await sqsEntryPoint(makeEvent(makeRecord('a'), makeRecord('b')), context);

    deepEqual(handlerTraces.sort(), ['a:trace-a:session-a', 'b:trace-b:session-b']);
  });

  it('assert :: a record the invocation has no time left for is handed back unstarted', async () => {
    handlerDelay = 20;

    const shortContext = {
      ...context,
      getRemainingTimeInMillis: () => 1_015
    };

    const response = await sqsEntryPoint(makeEvent(makeRecord('a'), makeRecord('b')), shortContext);

    deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'message-b' }] });
    deepEqual(handledMessages, ['a']);
    deepEqual(sentCommands, ['delete receipt-a']);
  });

  it('assert :: a failure the batch response cannot carry fails the invocation after the records in flight', async () => {
    runtime.__EZ4_PARALLELISM = 2;
    handlerDelay = 20;
    failingEvent = ServiceEventType.Error;
    failingMessages.add('a');

    const event = makeEvent(makeRecord('a'), makeRecord('b'), makeRecord('c'));

    await rejects(() => sqsEntryPoint(event, context), /Listener failed on error/);

    deepEqual(handledMessages, ['a', 'b']);
    ok(handlerEvents.includes('end b'));
  });

  it('assert :: the timeout reaches every record in flight', async () => {
    runtime.__EZ4_PARALLELISM = 2;
    handlerDelay = 60;

    const shortContext = {
      ...context,
      getRemainingTimeInMillis: () => 1_030
    };

    await sqsEntryPoint(makeEvent(makeRecord('a'), makeRecord('b')), shortContext);

    deepEqual(timeoutTraces.sort(), ['a:trace-a:session-a', 'b:trace-b:session-b']);
  });
});
