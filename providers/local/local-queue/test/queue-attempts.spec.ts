import { deepEqual, equal, ok } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { QueueTester } from '../src/service/tester';
import { getQueueService, loadProbe, startQueue, useQueueProbe } from './queue';
import { useTestClock, waitFor } from './clock';

const MESSAGE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const failHandler = () => {
  throw new Error('Handler failure.');
};

describe('local queue attempts', () => {
  before(() => loadProbe());

  it('assert :: the first delivery is attempt 1 of the default 3', async (t) => {
    const probe = useQueueProbe(t);

    const { client } = await startQueue(t, getQueueService('attemptQueue'));

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.requests.length === 1);

    deepEqual(
      probe.requests.map(({ attempt, maxAttempts }) => ({ attempt, maxAttempts })),
      [{ attempt: 1, maxAttempts: 3 }]
    );
  });

  it('assert :: max attempts come from the dead-letter queue', async (t) => {
    const probe = useQueueProbe(t);

    const { client } = await startQueue(
      t,
      getQueueService('maxAttemptsQueue', {
        deadLetter: {
          maxAttempts: 5
        }
      })
    );

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.requests.length === 1);

    deepEqual(
      probe.requests.map(({ attempt, maxAttempts }) => ({ attempt, maxAttempts })),
      [{ attempt: 1, maxAttempts: 5 }]
    );
  });

  it('assert :: a failed message comes back after the backoff as the next attempt', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setHandler(failHandler);

    const { client } = await startQueue(
      t,
      getQueueService('backoffQueue', {
        backoff: {
          minDelay: 7,
          maxDelay: 7
        }
      })
    );

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.requests.length === 1);

    await clock.advance(6999);

    deepEqual(probe.getRuns(), [['a', 1]]);

    await clock.advance(1);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['a', 2]
    ]);
  });

  it('assert :: a message that keeps failing moves to the dead-letter queue', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    const errorLog = t.mock.method(Logger, 'error');

    probe.setHandler(failHandler);

    const { client } = await startQueue(
      t,
      getQueueService('deadLetterQueue', {
        deadLetter: {
          maxAttempts: 2
        },
        backoff: {
          minDelay: 1,
          maxDelay: 1
        }
      })
    );

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.requests.length === 1);

    await clock.advance(5000);

    deepEqual(
      probe.requests.map(({ attempt, maxAttempts }) => ({ attempt, maxAttempts })),
      [
        { attempt: 1, maxAttempts: 2 },
        { attempt: 2, maxAttempts: 2 }
      ]
    );

    deepEqual(QueueTester.getDeadLetterMessages('deadLetterQueue'), [{ id: 'a' }]);

    const logLines = errorLog.mock.calls.map(({ arguments: [line] }) => `${line}`);

    ok(logLines.some((line) => line.includes('[deadLetterQueue]') && MESSAGE_ID.test(line)));
  });

  it('assert :: without a dead-letter queue a failing message is retried until it expires', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    const warnLog = t.mock.method(Logger, 'warn');

    probe.setHandler(failHandler);

    const { client } = await startQueue(
      t,
      getQueueService('expiringQueue', {
        retention: 1,
        backoff: {
          minDelay: 10,
          maxDelay: 10
        }
      })
    );

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.requests.length === 1);

    await clock.advance(120_000);

    deepEqual(
      probe.requests.map(({ attempt, maxAttempts }) => [attempt, maxAttempts]),
      [
        [1, 3],
        [2, 3],
        [3, 3],
        [4, 3],
        [5, 3],
        [6, 3]
      ]
    );

    const failureLines = warnLog.mock.calls
      .map(({ arguments: [line] }) => `${line}`)
      .filter((line) => line.includes('[expiringQueue]') && line.includes('failed on attempt'));

    // One line for each failed attempt.
    equal(failureLines.length, 6);

    await QueueTester.waitForDrain('expiringQueue');
  });

  it('assert :: retry with a delay hands the message back for that long and counts the attempt', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setHandler(async ({ attempt, retry }) => {
      if (attempt === 1) {
        await retry({ delay: 42 });
      }
    });

    const { client } = await startQueue(t, getQueueService('retryDelayQueue'));

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.requests.length === 1);

    await clock.advance(41_999);

    deepEqual(probe.getRuns(), [['a', 1]]);

    await clock.advance(1);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['a', 2]
    ]);
  });

  it('assert :: retry without a delay uses the queue backoff', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setHandler(async ({ attempt, retry }) => {
      if (attempt === 1) {
        await retry();
      }
    });

    const { client } = await startQueue(
      t,
      getQueueService('retryBackoffQueue', {
        backoff: {
          minDelay: 9,
          maxDelay: 9
        }
      })
    );

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.requests.length === 1);

    await clock.advance(8999);

    deepEqual(probe.getRuns(), [['a', 1]]);

    await clock.advance(1);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['a', 2]
    ]);
  });
});
