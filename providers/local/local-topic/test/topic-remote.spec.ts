import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { TopicImport } from '@ez4/topic/library';
import type { Mock } from 'node:test';
import type { TestClock } from './clock';
import type { TestServer } from './server';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { registerRemoteService } from '../src/provider/remote';
import { useTestClock, waitFor } from './clock';
import { startTestServer } from './server';

const context = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

const getOptions = (ownerHost: string) => {
  return {
    prefix: 'ez4',
    projectName: 'consumer',
    branchName: '',
    serviceHost: 'localhost:0',
    version: 1,
    localOptions: {},
    testOptions: {},
    suppress: false,
    imports: {
      owner: {
        prefix: 'ez4',
        projectName: 'owner',
        branchName: '',
        serviceHost: ownerHost
      }
    }
  } as ServeOptions;
};

const getTopicImport = (name: string) => {
  return {
    type: '@ez4/import:topic',
    name,
    reference: 'sharedTopic',
    project: 'owner',
    services: {},
    variables: {},
    subscriptions: [],
    schema: {
      type: 'object',
      properties: {
        foo: {
          type: 'string'
        }
      }
    }
  } as unknown as TopicImport;
};

const getSubscriptionTimes = (owner: TestServer) => {
  return owner.requests.filter(({ path }) => path.endsWith('/subscribe')).map(({ time }) => time);
};

const getMessages = (logger: Mock<(message: string) => void>) => {
  return logger.mock.calls.map(({ arguments: [message] }) => message).filter((message) => message.includes('[sharedTopic]'));
};

// The next timer is scheduled once the answer from the owner is handled.
const runNextSubscription = async (clock: TestClock, owner: TestServer) => {
  const subscriptions = getSubscriptionTimes(owner).length;

  await clock.runNextTimer();
  await waitFor(() => getSubscriptionTimes(owner).length > subscriptions);
  await clock.waitForTimer();
};

describe('local topic remote subscription', () => {
  it('assert :: subscription is retried until the owner answers', async (t) => {
    const owner = await startTestServer();
    const clock = useTestClock(t);

    const log = t.mock.method(Logger, 'log');
    const warn = t.mock.method(Logger, 'warn');

    const topic = registerRemoteService(getTopicImport('retryTopic'), getOptions(owner.host), context);

    owner.setAvailable(false);

    try {
      await topic.bootstrapHandler();

      for (let retry = 1; retry <= 6; retry++) {
        owner.setAvailable(retry === 6);

        await runNextSubscription(clock, owner);
      }

      deepEqual(getSubscriptionTimes(owner), [0, 1000, 3000, 7000, 15000, 25000, 35000]);

      equal(getMessages(warn).length, 1);
      equal(getMessages(log).length, 1);
    } finally {
      await topic.shutdownHandler();
      await owner.close();
    }
  });

  it('assert :: subscription is renewed and restored after the owner restarts', async (t) => {
    const owner = await startTestServer();
    const clock = useTestClock(t);

    const log = t.mock.method(Logger, 'log');
    const warn = t.mock.method(Logger, 'warn');

    const topic = registerRemoteService(getTopicImport('renewTopic'), getOptions(owner.host), context);

    try {
      await topic.bootstrapHandler();

      await runNextSubscription(clock, owner);
      await runNextSubscription(clock, owner);

      // The owner restarts and misses one renewal.
      owner.setAvailable(false);

      await runNextSubscription(clock, owner);

      owner.setAvailable(true);

      await runNextSubscription(clock, owner);
      await runNextSubscription(clock, owner);

      deepEqual(getSubscriptionTimes(owner), [0, 15000, 30000, 45000, 46000, 61000]);

      // Subscribed, lost and subscribed again, the renewals aren't logged.
      equal(getMessages(log).length, 2);
      equal(getMessages(warn).length, 1);
    } finally {
      await topic.shutdownHandler();
      await owner.close();
    }
  });

  it('assert :: shutdown stops the subscription and unsubscribes', async (t) => {
    const owner = await startTestServer();
    const clock = useTestClock(t);

    const topic = registerRemoteService(getTopicImport('stopTopic'), getOptions(owner.host), context);

    try {
      await topic.bootstrapHandler();
      await topic.shutdownHandler();

      equal(await clock.runNextTimer(), false);

      deepEqual(
        owner.requests.map(({ path }) => path),
        ['/ez4-owner-shared-topic/subscribe', '/ez4-owner-shared-topic/unsubscribe']
      );
    } finally {
      await owner.close();
    }
  });

  it('assert :: shutdown stops the subscription retries', async (t) => {
    const owner = await startTestServer();
    const clock = useTestClock(t);

    const topic = registerRemoteService(getTopicImport('stopRetryTopic'), getOptions(owner.host), context);

    owner.setAvailable(false);

    try {
      await topic.bootstrapHandler();
      await topic.shutdownHandler();

      equal(await clock.runNextTimer(), false);

      equal(getSubscriptionTimes(owner).length, 1);
    } finally {
      await owner.close();
    }
  });
});
