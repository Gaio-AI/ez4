import type { EmulateServiceContext, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { TopicImport, TopicService } from '@ez4/topic/library';

import { deepEqual, equal } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { registerRemoteService } from '../src/provider/remote';
import { registerLocalService } from '../src/provider/local';
import { useTestClock, waitFor } from './clock';

const options = {
  prefix: 'ez4',
  projectName: 'retry',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {}
} as ServeOptions;

const getContext = (queueMessages: unknown[]) => {
  const queueClient = {
    sendMessage: async (message: unknown) => {
      queueMessages.push(message);
    }
  };

  return {
    makeClients: () => ({}),
    makeClient: () => queueClient
  } as unknown as EmulateServiceContext;
};

const getTopicService = (name: string) => {
  return {
    type: '@ez4/topic',
    name,
    services: {},
    variables: {},
    schema: {
      type: 'object',
      properties: {
        foo: {
          type: 'string'
        }
      }
    },
    subscriptions: [
      {
        type: 'lambda',
        handler: {
          name: 'failureProbe',
          file: 'test/fixtures/failure-probe.ts',
          position: [1, 1]
        }
      },
      {
        type: 'queue',
        service: 'retryQueue'
      }
    ]
  } as unknown as TopicService;
};

const publishRequest: EmulatorRequestEvent = {
  method: 'POST',
  path: '/',
  query: {},
  headers: {},
  body: Buffer.from(JSON.stringify({ foo: 'bar' }))
};

describe('local topic lambda retries', () => {
  afterEach(() => {
    globalThis.probeFailure = undefined;
  });

  it('assert :: failed lambda subscription is retried twice then dropped', async (t) => {
    const clock = useTestClock(t);
    const error = t.mock.method(Logger, 'error');

    const queueMessages: unknown[] = [];
    const attempts: number[] = [];

    globalThis.probeFailure = () => {
      attempts.push(Date.now());
      return true;
    };

    const topic = registerLocalService(getTopicService('droppedTopic'), options, getContext(queueMessages));

    const response = await topic.requestHandler(publishRequest);

    equal(response.status, 201);

    await waitFor(() => attempts.length === 1);

    for (let retry = 1; retry <= 2; retry++) {
      await clock.runNextTimer();
      await waitFor(() => attempts.length > retry);
    }

    equal(await clock.runNextTimer(), false);

    deepEqual(attempts, [0, 1000, 3000]);
    deepEqual(queueMessages, [{ foo: 'bar' }]);

    const dropMessages = error.mock.calls.filter(({ arguments: [message] }) => message.includes('[droppedTopic]'));

    equal(dropMessages.length, 1);
  });

  it('assert :: lambda subscription that recovers is not retried again', async (t) => {
    const clock = useTestClock(t);

    const queueMessages: unknown[] = [];
    const attempts: number[] = [];

    globalThis.probeFailure = () => {
      attempts.push(Date.now());
      return attempts.length === 1;
    };

    const topic = registerLocalService(getTopicService('recoveredTopic'), options, getContext(queueMessages));

    await topic.requestHandler(publishRequest);

    await waitFor(() => attempts.length === 1);

    await clock.runNextTimer();
    await waitFor(() => attempts.length === 2);

    equal(await clock.runNextTimer(), false);

    deepEqual(attempts, [0, 1000]);
    deepEqual(queueMessages, [{ foo: 'bar' }]);
  });

  it('assert :: lambda subscription of an imported topic is retried', async (t) => {
    const clock = useTestClock(t);

    const queueMessages: unknown[] = [];
    const attempts: number[] = [];

    globalThis.probeFailure = () => {
      attempts.push(Date.now());
      return attempts.length === 1;
    };

    const topicImport = {
      ...getTopicService('importedTopic'),
      type: '@ez4/import:topic',
      reference: 'ownerTopic',
      project: 'owner'
    } as unknown as TopicImport;

    const importOptions = {
      ...options,
      imports: {
        owner: {
          prefix: 'ez4',
          projectName: 'owner',
          branchName: '',
          serviceHost: 'localhost:0'
        }
      }
    };

    const topic = registerRemoteService(topicImport, importOptions, getContext(queueMessages));

    const response = await topic.requestHandler(publishRequest);

    equal(response.status, 201);

    await waitFor(() => attempts.length === 1);

    await clock.runNextTimer();
    await waitFor(() => attempts.length === 2);

    deepEqual(attempts, [0, 1000]);
    deepEqual(queueMessages, [{ foo: 'bar' }]);
  });
});
