import type { DeployOptions, EventContext, ServiceStates } from '@ez4/project/library';
import type { QueueService, QueueSubscription } from '@ez4/queue/library';
import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import type { EntryStates, StepContext } from '@ez4/state';

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { deepEqual, ok } from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DeleteMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
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

const options = {
  prefix: 'ez4',
  projectName: 'acknowledge',
  branchName: ''
} as DeployOptions;

const lambdaContext = {
  awsRequestId: 'request-id',
  getRemainingTimeInMillis: () => 30_000
} as Context;

const deletedMessages: string[] = [];

const getService = (handlerName: string, subscription: Partial<QueueSubscription>) => {
  return {
    type: '@ez4/queue',
    name: 'AcknowledgeQueue',
    context: {},
    variables: {},
    services: {},
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
          file: 'test/files/acknowledge.js'
        },
        ...subscription
      }
    ]
  } as unknown as QueueService;
};

const getContext = (state: EntryStates) => {
  const services: ServiceStates = {};

  const role = createRole(state, [], {
    roleName: 'ez4-test-acknowledge-role',
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

/**
 * Bundles the subscription function the queue prepares, as a deploy does, and loads its entry point. Bundles are
 * cached per handler, so every case takes a handler of its own.
 */
const loadEntryPoint = async (handlerName: string, subscription: Partial<QueueSubscription>) => {
  const state: EntryStates = {};

  prepareServices({ state, service: getService(handlerName, subscription), metadata: {}, options, context: getContext(state) });

  const [functionState] = Object.values(state).filter((entry) => entry && isFunctionState(entry));

  ok(functionState && isFunctionState(functionState));

  const bundleFile = await functionState.parameters.getFunctionBundle({
    getDependencies: () => [],
    getConnections: () => []
  } as unknown as StepContext);

  return (await import(pathToFileURL(resolve(bundleFile)).href)) as EntryPoint;
};

const makeRecord = (id: string): SQSRecord => {
  return {
    messageId: `message-${id}`,
    receiptHandle: `receipt-${id}`,
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

describe('queue subscription acknowledge', () => {
  beforeEach(() => {
    deletedMessages.length = 0;

    mock.method(SQSClient.prototype, 'send', async (command: unknown) => {
      if (command instanceof DeleteMessageCommand && command.input.ReceiptHandle) {
        deletedMessages.push(command.input.ReceiptHandle);
      }

      return {};
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: the subscription function deletes each record of a longer batch by default', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('recordHandler', {});

    const response = await sqsEntryPoint({ Records: [makeRecord('a'), makeRecord('b')] }, lambdaContext);

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(deletedMessages, ['receipt-a', 'receipt-b']);
  });

  it('assert :: the subscription function with batch acknowledge leaves the deletes to the event source mapping', async () => {
    const { sqsEntryPoint } = await loadEntryPoint('batchHandler', { acknowledge: 'batch' });

    const response = await sqsEntryPoint({ Records: [makeRecord('a'), makeRecord('b')] }, lambdaContext);

    deepEqual(response, { batchItemFailures: [] });
    deepEqual(deletedMessages, []);
  });
});
