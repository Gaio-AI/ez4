import type { DeployOptions, EventContext, ServiceStates } from '@ez4/project/library';
import type { QueueService, QueueSubscription } from '@ez4/queue/library';
import type { Context, SQSEvent, SQSMessageAttributes, SQSRecord } from 'aws-lambda';
import type { EntryStates, StepContext } from '@ez4/state';

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ChangeMessageVisibilityCommand, DeleteMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DeleteItemCommand, DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { getServiceState, setServiceState } from '@ez4/project/library';
import { isFunctionState } from '@ez4/aws-function';
import { createRole } from '@ez4/aws-identity';

import { prepareServices } from '../src/triggers/service';
import { getRoleDocument } from './common/role';

// The package bundler defines __MODULE_PATH; source imports in tests need it set.
(globalThis as { __MODULE_PATH?: string }).__MODULE_PATH = join(import.meta.dirname, '../dist');

type EntryPoint = {
  sqsEntryPoint: (event: SQSEvent, context: Context) => Promise<unknown>;
};

type RecordOptions = {
  delay?: number;
  groupId?: string;
  attributes?: Record<string, string>;
};

const options = {
  prefix: 'ez4',
  projectName: 'defer',
  branchName: ''
} as DeployOptions;

const lambdaContext = {
  awsRequestId: 'request-id',
  getRemainingTimeInMillis: () => 30_000
} as Context;

const LEASE = 90;

const sentCopies: SendMessageCommand['input'][] = [];
const deletedMessages: string[] = [];
const retriedMessages: string[] = [];

// Slots held like the table holds them under the two conditions the runtime sends for them: take one that's free
// or expired, and delete one only for the execution that owns it.
const slots = new Map<string, { owner: string; expiresAt: number }>();
const slotSteps: string[] = [];

const getRuns = (handlerName: string) => {
  return (globalThis as { __deferRuns?: Record<string, number> }).__deferRuns?.[handlerName] ?? 0;
};

const getNow = () => Math.floor(Date.now() / 1000);

const getService = (handlerName: string, subscription: Partial<QueueSubscription>) => {
  return {
    type: '@ez4/queue',
    name: 'DeferQueue',
    context: {},
    variables: {},
    services: {},
    timeout: LEASE,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string'
        },
        delay: {
          type: 'number',
          optional: true
        }
      }
    },
    subscriptions: [
      {
        handler: {
          name: handlerName,
          file: 'test/files/defer.js'
        },
        ...subscription
      }
    ]
  } as unknown as QueueService;
};

const getContext = (state: EntryStates) => {
  const services: ServiceStates = {};

  const role = createRole(state, [], {
    roleName: 'ez4-test-defer-role',
    roleDocument: getRoleDocument()
  });

  const context: Pick<EventContext, 'role' | 'setServiceState' | 'getServiceState' | 'getDependencyFiles'> = {
    role,
    setServiceState: (service, options, entry) => setServiceState(services, entry, service, options),
    getServiceState: (service, options) => getServiceState(services, service, options),
    getDependencyFiles: () => []
  };

  return context as EventContext;
};

const prepareState = (handlerName: string, subscription: Partial<QueueSubscription>) => {
  const state: EntryStates = {};

  prepareServices({ state, service: getService(handlerName, subscription), metadata: {}, options, context: getContext(state) });

  return state;
};

/**
 * Bundles the subscription function the queue prepares, as a deploy does, and loads its entry point. Bundles are
 * cached per handler, so every case takes a handler of its own.
 */
const loadEntryPoint = async (handlerName: string, subscription: Partial<QueueSubscription> = {}) => {
  const state = prepareState(handlerName, subscription);

  const [functionState] = Object.values(state).filter((entry) => entry && isFunctionState(entry));

  ok(functionState && isFunctionState(functionState));

  const bundleFile = await functionState.parameters.getFunctionBundle({
    getDependencies: () => [],
    getConnections: () => []
  } as unknown as StepContext);

  return (await import(pathToFileURL(resolve(bundleFile)).href)) as EntryPoint;
};

const makeRecord = (id: string, receipt: string, recordOptions: RecordOptions = {}): SQSRecord => {
  const messageAttributes: SQSMessageAttributes = {
    ['EZ4.TRACE_ID']: { stringValue: 'trace-defer', dataType: 'String', stringListValues: [], binaryListValues: [] }
  };

  for (const [name, value] of Object.entries(recordOptions.attributes ?? {})) {
    messageAttributes[name] = { stringValue: value, dataType: 'Number', stringListValues: [], binaryListValues: [] };
  }

  return {
    messageId: `message-${receipt}`,
    receiptHandle: `receipt-${receipt}`,
    body: JSON.stringify({ id, ...(recordOptions.delay !== undefined && { delay: recordOptions.delay }) }),
    attributes: {
      ApproximateReceiveCount: '1',
      ApproximateFirstReceiveTimestamp: '0',
      SentTimestamp: '0',
      SenderId: 'sender',
      ...(recordOptions.groupId && { MessageGroupId: recordOptions.groupId })
    },
    messageAttributes,
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
    awsRegion: 'us-east-1'
  };
};

const getAttribute = (copy: SendMessageCommand['input'], name: string) => {
  return copy.MessageAttributes?.[name]?.StringValue;
};

const conditionFailed = () => {
  return Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
};

const sendSlotRequest = async (command: UpdateItemCommand | DeleteItemCommand) => {
  const key = command.input.Key?.id?.S;
  const owner = command.input.ExpressionAttributeValues?.[':owner']?.S;

  ok(key && owner);

  const slot = slots.get(key);

  if (command instanceof DeleteItemCommand) {
    if (slot?.owner !== owner) {
      throw conditionFailed();
    }

    slotSteps.push('release');
    slots.delete(key);

    return {};
  }

  ok(command.input.ConditionExpression === 'attribute_not_exists(#key) OR #expiration <= :now');

  if (slot && slot.expiresAt > getNow()) {
    throw conditionFailed();
  }

  slotSteps.push('take');
  slots.set(key, { owner, expiresAt: Number(command.input.ExpressionAttributeValues?.[':expiration']?.N) });

  return {};
};

const getSlotKey = (handlerName: string, id: string, slot: number) => {
  return JSON.stringify({ handler: handlerName, key: [id], slot });
};

describe('queue subscription defer and key concurrency', () => {
  beforeEach(() => {
    sentCopies.length = 0;
    deletedMessages.length = 0;
    retriedMessages.length = 0;
    slotSteps.length = 0;

    slots.clear();

    mock.method(SQSClient.prototype, 'send', async (command: unknown) => {
      if (command instanceof SendMessageCommand) {
        sentCopies.push(command.input);
      }

      if (command instanceof DeleteMessageCommand && command.input.ReceiptHandle) {
        deletedMessages.push(command.input.ReceiptHandle);
      }

      if (command instanceof ChangeMessageVisibilityCommand && command.input.ReceiptHandle) {
        retriedMessages.push(command.input.ReceiptHandle);
      }

      return {};
    });

    mock.method(DynamoDBClient.prototype, 'send', sendSlotRequest);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: a deferred message goes back as a copy and the delivery is consumed', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('deferHandler');

    const response = await sqsEntryPoint(
      { Records: [makeRecord('a', 'first', { delay: 60 }), makeRecord('b', 'second', { delay: 30 })] },
      lambdaContext
    );

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(deletedMessages, ['receipt-first', 'receipt-second']);
    deepEqual(retriedMessages, []);

    const [copy] = sentCopies;

    equal(sentCopies.length, 2);
    equal(copy.QueueUrl, 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue');
    equal(copy.MessageBody, JSON.stringify({ id: 'a', delay: 60 }));
    equal(copy.DelaySeconds, 60);
    equal(getAttribute(copy, 'EZ4.TRACE_ID'), 'trace-defer');
    equal(getAttribute(copy, 'EZ4.DEFERS'), '1');
    equal(getAttribute(copy, 'EZ4.DEFER_UNTIL'), undefined);
  });

  it('assert :: each defer counts once more', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('deferHandler');

    await sqsEntryPoint({ Records: [makeRecord('a', 'again', { delay: 60, attributes: { 'EZ4.DEFERS': '3' } })] }, lambdaContext);

    equal(getAttribute(sentCopies[0], 'EZ4.DEFERS'), '4');
  });

  it('assert :: a message past the most defers fails like with an error', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('deferHandler');

    const response = await sqsEntryPoint(
      { Records: [makeRecord('a', 'limit', { delay: 60, attributes: { 'EZ4.DEFERS': '20' } })] },
      lambdaContext
    );

    deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'message-limit' }] });
    deepEqual(retriedMessages, ['receipt-limit']);
    deepEqual(sentCopies, []);
  });

  it('assert :: a delay above 900 seconds goes as waits of 900 carrying when it is due', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('deferHandler');

    const before = getNow();

    await sqsEntryPoint({ Records: [makeRecord('a', 'long', { delay: 2000 })] }, lambdaContext);

    const [copy] = sentCopies;

    equal(copy.DelaySeconds, 900);

    const deferUntil = Number(getAttribute(copy, 'EZ4.DEFER_UNTIL'));

    ok(deferUntil >= before + 2000 && deferUntil <= getNow() + 2000);
  });

  it('assert :: a copy that comes back early waits again without running the handler', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('deferHandler');

    const record = makeRecord('a', 'early', { delay: 2000, attributes: { 'EZ4.DEFERS': '1', 'EZ4.DEFER_UNTIL': `${getNow() + 500}` } });
    const runs = getRuns('deferHandler');

    deepEqual(await sqsEntryPoint({ Records: [record] }, lambdaContext), { batchItemFailures: [] });

    equal(getRuns('deferHandler'), runs);

    const [copy] = sentCopies;

    ok(copy.DelaySeconds! >= 499 && copy.DelaySeconds! <= 500);
    equal(getAttribute(copy, 'EZ4.DEFERS'), '2');
    equal(getAttribute(copy, 'EZ4.DEFER_UNTIL'), undefined);
  });

  it('assert :: a message of a fifo queue cannot be deferred', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('deferHandler');

    const response = await sqsEntryPoint({ Records: [makeRecord('a', 'fifo', { delay: 60, groupId: 'group' })] }, lambdaContext);

    deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'message-fifo' }] });
    deepEqual(sentCopies, []);
  });

  it('assert :: a handler that fails after deferring is consumed, its copy goes on', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('deferThenFailHandler');

    const response = await sqsEntryPoint({ Records: [makeRecord('a', 'failed')] }, lambdaContext);

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(retriedMessages, []);

    equal(sentCopies.length, 1);
  });

  it('assert :: a free slot is taken while the handler runs and released after it', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('slotHandler', { keyConcurrency: { key: ['id'], max: 1 } });

    deepEqual(await sqsEntryPoint({ Records: [makeRecord('a', 'slot')] }, lambdaContext), { batchItemFailures: [] });

    equal(getRuns('slotHandler'), 1);
    deepEqual(slotSteps, ['take', 'release']);
    equal(slots.size, 0);
    deepEqual(sentCopies, []);
  });

  it('assert :: a message without a free slot waits its turn without running or spending an attempt', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('busySlotHandler', { keyConcurrency: { key: ['id'], max: 2 } });

    slots.set(getSlotKey('busySlotHandler', 'a', 0), { owner: 'other', expiresAt: getNow() + LEASE });
    slots.set(getSlotKey('busySlotHandler', 'a', 1), { owner: 'other', expiresAt: getNow() + LEASE });

    const response = await sqsEntryPoint({ Records: [makeRecord('a', 'busy', { attributes: { 'EZ4.DEFERS': '2' } })] }, lambdaContext);

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(retriedMessages, []);

    equal(getRuns('busySlotHandler'), 0);

    const [copy] = sentCopies;

    ok(copy.DelaySeconds! >= 5 && copy.DelaySeconds! <= 30);
    equal(getAttribute(copy, 'EZ4.DEFERS'), '2');
  });

  it('assert :: a queue with key concurrency gets the claims table', () => {
    const state = prepareState('slotHandler', { keyConcurrency: { key: ['id'], max: 1 } });

    const tables = Object.values(state).filter((entry) => entry?.type === 'aws:dynamodb.table');

    equal(tables.length, 1);
  });
});
