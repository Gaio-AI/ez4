import type { DeployOptions, EventContext, ServiceStates } from '@ez4/project/library';
import type { QueueService } from '@ez4/queue/library';
import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import type { EntryStates, StepContext } from '@ez4/state';

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { ok } from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs';
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
  projectName: 'retry-window',
  branchName: ''
} as DeployOptions;

const lambdaContext = {
  awsRequestId: 'request-id',
  getRemainingTimeInMillis: () => 30_000
} as Context;

const RetryWindow = 600;

const visibilities: number[] = [];

const getService = (handlerName: string, attributes: Partial<QueueService>) => {
  return {
    type: '@ez4/queue',
    name: 'RetryWindowQueue',
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
          file: 'test/files/retry-window.js'
        }
      }
    ],
    ...attributes
  } as unknown as QueueService;
};

const getContext = (state: EntryStates) => {
  const services: ServiceStates = {};

  const role = createRole(state, [], {
    roleName: 'ez4-test-retry-window-role',
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
const loadEntryPoint = async (handlerName: string, attributes: Partial<QueueService>) => {
  const state: EntryStates = {};

  prepareServices({ state, service: getService(handlerName, attributes), metadata: {}, options, context: getContext(state) });

  const [functionState] = Object.values(state).filter((entry) => entry && isFunctionState(entry));

  ok(functionState && isFunctionState(functionState));

  const bundleFile = await functionState.parameters.getFunctionBundle({
    getDependencies: () => [],
    getConnections: () => []
  } as unknown as StepContext);

  return (await import(pathToFileURL(resolve(bundleFile)).href)) as EntryPoint;
};

const makeRecord = (receiveCount: number): SQSRecord => {
  return {
    messageId: `message-${receiveCount}`,
    receiptHandle: `receipt-${receiveCount}`,
    body: JSON.stringify({ id: 'a' }),
    attributes: {
      ApproximateReceiveCount: `${receiveCount}`,
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

/**
 * Fails the message once per receive, from the first to the last attempt, and answers how long each failure kept it
 * out of sight before the next receive.
 */
const getRetryDelays = async (entryPoint: EntryPoint, maxAttempts: number) => {
  visibilities.length = 0;

  for (let receiveCount = 1; receiveCount < maxAttempts; receiveCount++) {
    await entryPoint.sqsEntryPoint({ Records: [makeRecord(receiveCount)] }, lambdaContext);
  }

  return [...visibilities];
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('queue subscription retry window', () => {
  beforeEach(() => {
    mock.method(SQSClient.prototype, 'send', async (command: unknown) => {
      if (command instanceof ChangeMessageVisibilityCommand && command.input.VisibilityTimeout !== undefined) {
        visibilities.push(command.input.VisibilityTimeout);
      }

      return {};
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: without a backoff the first retry comes soon and the last attempt only after the retry window', async () => {
    const entryPoint = await loadEntryPoint('defaultHandler', { deadLetter: { maxAttempts: 3 } });

    for (let counter = 0; counter < 20; counter++) {
      const [first, second] = await getRetryDelays(entryPoint, 3);

      ok(first >= 5 && first <= 30, `first retry after ${first} s`);
      ok(first + second >= RetryWindow, `last attempt after ${first + second} s`);
    }
  });

  it('assert :: without a backoff the retries of a longer queue split the retry window', async () => {
    const entryPoint = await loadEntryPoint('sixAttemptsHandler', { deadLetter: { maxAttempts: 6 } });

    for (let counter = 0; counter < 20; counter++) {
      const delays = await getRetryDelays(entryPoint, 6);

      ok(delays[0] >= 5 && delays[0] <= 30, `first retry after ${delays[0]} s`);
      ok(sum(delays) >= RetryWindow, `last attempt after ${sum(delays)} s`);
    }
  });

  it('assert :: without a backoff a queue with two attempts waits the whole retry window for its only retry', async () => {
    const entryPoint = await loadEntryPoint('twoAttemptsHandler', { deadLetter: { maxAttempts: 2 } });

    for (let counter = 0; counter < 20; counter++) {
      const delays = await getRetryDelays(entryPoint, 2);

      ok(sum(delays) >= RetryWindow, `only retry after ${sum(delays)} s`);
    }
  });

  it('assert :: without a backoff the last attempt reaches the dead-letter as soon as before', async () => {
    const lastAttempt = await loadEntryPoint('defaultHandler', { deadLetter: { maxAttempts: 3 } });
    const onlyAttempt = await loadEntryPoint('oneAttemptHandler', { deadLetter: { maxAttempts: 1 } });

    for (let counter = 0; counter < 20; counter++) {
      visibilities.length = 0;

      await lastAttempt.sqsEntryPoint({ Records: [makeRecord(3)] }, lambdaContext);
      await onlyAttempt.sqsEntryPoint({ Records: [makeRecord(1)] }, lambdaContext);

      ok(
        visibilities.every((delay) => delay >= 5 && delay <= 30),
        `dead-lettered after ${visibilities.join(', ')} s`
      );
    }
  });

  it('assert :: a declared backoff keeps its own delays', async () => {
    const entryPoint = await loadEntryPoint('backoffHandler', {
      deadLetter: { maxAttempts: 3 },
      backoff: { minDelay: 5, maxDelay: 20 }
    });

    for (let counter = 0; counter < 20; counter++) {
      const delays = await getRetryDelays(entryPoint, 3);

      ok(
        delays.every((delay) => delay >= 5 && delay <= 20),
        `retries after ${delays.join(', ')} s`
      );
    }
  });
});
