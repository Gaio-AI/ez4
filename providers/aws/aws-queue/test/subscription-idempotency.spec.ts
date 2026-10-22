import type { DeployOptions, EventContext, ServiceStates } from '@ez4/project/library';
import type { QueueService, QueueSubscription } from '@ez4/queue/library';
import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import type { EntryStates, StepContext } from '@ez4/state';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { TableState } from '@ez4/aws-dynamodb';

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ChangeMessageVisibilityCommand, DeleteMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
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

type ClaimItem = {
  state: string;
  owner: string;
  expires_at: number;
};

const options = {
  prefix: 'ez4',
  projectName: 'idempotency',
  branchName: ''
} as DeployOptions;

const lambdaContext = {
  awsRequestId: 'request-id',
  getRemainingTimeInMillis: () => 30_000
} as Context;

const TTL = 3600;
const LEASE = 90;

const claimsTable = new Map<string, ClaimItem>();
const deletedMessages: string[] = [];
const retriedMessages: string[] = [];

let claimRequests: (UpdateItemCommand | DeleteItemCommand)['input'][] = [];

const getRuns = (handlerName: string) => {
  return (globalThis as { __idempotencyRuns?: Record<string, number> }).__idempotencyRuns?.[handlerName] ?? 0;
};

const getNow = () => Math.floor(Date.now() / 1000);

const getService = (handlerName: string, subscription: Partial<QueueSubscription>) => {
  return {
    type: '@ez4/queue',
    name: 'IdempotencyQueue',
    context: {},
    variables: {},
    services: {},
    timeout: LEASE,
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string'
        }
      }
    },
    subscriptions: [
      {
        handler: {
          name: handlerName,
          file: 'test/files/idempotency.js'
        },
        ...subscription
      }
    ]
  } as unknown as QueueService;
};

const getContext = (state: EntryStates) => {
  const services: ServiceStates = {};

  const role = createRole(state, [], {
    roleName: 'ez4-test-idempotency-role',
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
const loadEntryPoint = async (handlerName: string, subscription: Partial<QueueSubscription>) => {
  const state = prepareState(handlerName, subscription);

  const [functionState] = Object.values(state).filter((entry) => entry && isFunctionState(entry));

  ok(functionState && isFunctionState(functionState));

  const bundleFile = await functionState.parameters.getFunctionBundle({
    getDependencies: () => [],
    getConnections: () => []
  } as unknown as StepContext);

  return (await import(pathToFileURL(resolve(bundleFile)).href)) as EntryPoint;
};

const makeRecord = (id: string, receipt: string): SQSRecord => {
  return {
    messageId: `message-${receipt}`,
    receiptHandle: `receipt-${receipt}`,
    body: JSON.stringify({ id }),
    attributes: {
      ApproximateReceiveCount: '1',
      ApproximateFirstReceiveTimestamp: '0',
      SentTimestamp: '0',
      SenderId: 'sender'
    },
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
    awsRegion: 'us-east-1'
  };
};

const getClaimSteps = () => {
  return claimRequests.map((input) => {
    if (!('UpdateExpression' in input)) {
      return 'release';
    }

    return input.ConditionExpression?.startsWith('attribute_not_exists') ? 'take' : 'keep';
  });
};

const getClaimKey = (handlerName: string, id: string) => {
  return JSON.stringify([handlerName, id]);
};

const toItem = (item: ClaimItem): Record<string, AttributeValue> => {
  return {
    state: { S: item.state },
    owner: { S: item.owner },
    expires_at: { N: `${item.expires_at}` }
  };
};

const conditionFailed = (item?: ClaimItem) => {
  return Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
    ...(item && { Item: toItem(item) })
  });
};

// Holds the claims like the table does under the three conditions the runtime sends: take a key that's free or
// expired, and keep or delete one only for the execution that owns it.
const sendClaimRequest = async (command: UpdateItemCommand | DeleteItemCommand) => {
  const { input } = command;

  claimRequests.push(input);

  const key = input.Key?.id?.S;
  const values = input.ExpressionAttributeValues ?? {};
  const owner = values[':owner']?.S;

  ok(key && owner);

  const item = claimsTable.get(key);

  if (command instanceof DeleteItemCommand) {
    if (item?.owner !== owner) {
      throw conditionFailed();
    }

    claimsTable.delete(key);
    return {};
  }

  const state = values[':state']?.S;
  const expiration = Number(values[':expiration']?.N);

  ok(state && Number.isFinite(expiration));

  if (input.ConditionExpression === 'attribute_not_exists(#key) OR #expiration <= :now') {
    if (item && item.expires_at > Number(values[':now']?.N)) {
      throw conditionFailed(command.input.ReturnValuesOnConditionCheckFailure === 'ALL_OLD' ? item : undefined);
    }

    claimsTable.set(key, { state, owner, expires_at: expiration });
    return {};
  }

  ok(item && input.ConditionExpression === '#owner = :owner');

  if (item.owner !== owner) {
    throw conditionFailed();
  }

  claimsTable.set(key, { ...item, state, expires_at: expiration });

  return {};
};

describe('queue subscription idempotency', () => {
  beforeEach(() => {
    claimsTable.clear();

    deletedMessages.length = 0;
    retriedMessages.length = 0;
    claimRequests = [];

    mock.method(SQSClient.prototype, 'send', async (command: unknown) => {
      if (command instanceof DeleteMessageCommand && command.input.ReceiptHandle) {
        deletedMessages.push(command.input.ReceiptHandle);
      }

      if (command instanceof ChangeMessageVisibilityCommand && command.input.ReceiptHandle) {
        retriedMessages.push(command.input.ReceiptHandle);
      }

      return {};
    });

    mock.method(DynamoDBClient.prototype, 'send', sendClaimRequest);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: the queue gets a claims table with a key and a ttl, and the function waits for it', () => {
    const state = prepareState('onceHandler', { idempotency: { key: ['id'], ttl: TTL } });

    const tables = Object.values(state).filter((entry): entry is TableState => entry?.type === 'aws:dynamodb.table');

    equal(tables.length, 1);

    const [table] = tables;

    equal(table.parameters.tableName, 'ez4-idempotency-idempotency-queue-claims');
    equal(table.parameters.ttlAttribute, 'expires_at');
    equal(table.parameters.allowDeletion, true);
    deepEqual(table.parameters.attributeSchema, [[{ attributeName: 'id', attributeType: 'S', keyType: 'HASH' }]]);

    const [functionState] = Object.values(state).filter((entry) => entry && isFunctionState(entry));

    ok(functionState?.dependencies.includes(table.entryId));
  });

  it('assert :: a queue without idempotency gets no claims table', () => {
    const state = prepareState('plainHandler', {});

    deepEqual(
      Object.values(state).filter((entry) => entry?.type === 'aws:dynamodb.table'),
      []
    );
  });

  it('assert :: a key that already ran is acknowledged without running the handler again', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('onceHandler', { idempotency: { key: ['id'], ttl: TTL } });

    deepEqual(await sqsEntryPoint({ Records: [makeRecord('a', 'first')] }, lambdaContext), { batchItemFailures: [] });
    deepEqual(await sqsEntryPoint({ Records: [makeRecord('a', 'again')] }, lambdaContext), { batchItemFailures: [] });

    equal(getRuns('onceHandler'), 1);

    const claim = claimsTable.get(getClaimKey('onceHandler', 'a'));

    equal(claim?.state, 'done');
    ok(claim.expires_at >= getNow() + TTL - 1);

    deepEqual(retriedMessages, []);
  });

  it('assert :: two deliveries in one batch run the handler once and both are deleted', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('batchOnceHandler', { idempotency: { key: ['id'], ttl: TTL } });

    const response = await sqsEntryPoint({ Records: [makeRecord('a', 'first'), makeRecord('a', 'second')] }, lambdaContext);

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(deletedMessages, ['receipt-first', 'receipt-second']);

    equal(getRuns('batchOnceHandler'), 1);
  });

  it('assert :: a key running in another execution sends the message back without running it', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('busyHandler', { idempotency: { key: ['id'], ttl: TTL } });

    claimsTable.set(getClaimKey('busyHandler', 'b'), { state: 'running', owner: 'other', expires_at: getNow() + LEASE });

    const response = await sqsEntryPoint({ Records: [makeRecord('b', 'busy')] }, lambdaContext);

    deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'message-busy' }] });
    deepEqual(retriedMessages, ['receipt-busy']);

    equal(getRuns('busyHandler'), 0);
    equal(claimsTable.get(getClaimKey('busyHandler', 'b'))?.owner, 'other');
  });

  it('assert :: a key whose lease or ttl has passed is taken again', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('expiredHandler', { idempotency: { key: ['id'], ttl: TTL } });

    claimsTable.set(getClaimKey('expiredHandler', 'e'), { state: 'done', owner: 'other', expires_at: getNow() - 1 });

    deepEqual(await sqsEntryPoint({ Records: [makeRecord('e', 'expired')] }, lambdaContext), { batchItemFailures: [] });

    equal(getRuns('expiredHandler'), 1);
    deepEqual(getClaimSteps(), ['take', 'keep']);

    const claim = claimsTable.get(getClaimKey('expiredHandler', 'e'));

    equal(claim?.state, 'done');
    ok(claim.owner !== 'other' && claim.expires_at >= getNow() + TTL - 1);
  });

  it('assert :: a failed handler frees the key for the next attempt', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('failingHandler', { idempotency: { key: ['id'], ttl: TTL } });

    const response = await sqsEntryPoint({ Records: [makeRecord('f', 'fail')] }, lambdaContext);

    deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'message-fail' }] });
    deepEqual(retriedMessages, ['receipt-fail']);

    deepEqual(getClaimSteps(), ['take', 'release']);
    equal(claimsTable.has(getClaimKey('failingHandler', 'f')), false);
  });

  it('assert :: a handler that calls retry frees the key', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('retryHandler', { idempotency: { key: ['id'], ttl: TTL } });

    const response = await sqsEntryPoint({ Records: [makeRecord('r', 'retry')] }, lambdaContext);

    deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'message-retry' }] });

    deepEqual(getClaimSteps(), ['take', 'release']);
    equal(claimsTable.has(getClaimKey('retryHandler', 'r')), false);
  });

  it('assert :: an unknown outcome keeps the key and consumes the message', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('unknownHandler', { idempotency: { key: ['id'], ttl: TTL } });

    deepEqual(await sqsEntryPoint({ Records: [makeRecord('u', 'unknown')] }, lambdaContext), { batchItemFailures: [] });
    deepEqual(retriedMessages, []);

    const claim = claimsTable.get(getClaimKey('unknownHandler', 'u'));

    equal(claim?.state, 'unknown');
    ok(claim.expires_at >= getNow() + TTL - 1);

    deepEqual(await sqsEntryPoint({ Records: [makeRecord('u', 'again')] }, lambdaContext), { batchItemFailures: [] });

    equal(getRuns('unknownHandler'), 1);
  });

  it('assert :: the key is held for the queue timeout while the handler runs', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('onceHandler', { idempotency: { key: ['id'], ttl: TTL } });

    const before = getNow();

    await sqsEntryPoint({ Records: [makeRecord('l', 'lease')] }, lambdaContext);

    const [takeRequest] = claimRequests;

    ok(takeRequest);
    equal(takeRequest.ExpressionAttributeNames?.['#expiration'], 'expires_at');

    const leaseEnd = Number(takeRequest.ExpressionAttributeValues?.[':expiration']?.N);

    ok(leaseEnd >= before + LEASE && leaseEnd <= getNow() + LEASE);
  });

  it('assert :: a subscription without idempotency never calls the claims table', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('plainHandler', {});

    await sqsEntryPoint({ Records: [makeRecord('p', 'plain'), makeRecord('p', 'plain-again')] }, lambdaContext);

    equal(getRuns('plainHandler'), 2);
    deepEqual(claimRequests, []);
  });
});
