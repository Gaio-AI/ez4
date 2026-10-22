import { deepEqual, equal } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { QueueTester } from '../src/service/tester';
import { getProbeSubscription, getQueueService, loadProbe, startQueue, useQueueProbe } from './queue';
import { useTestClock, waitFor } from './clock';

const TTL = 60;

const getIdempotentQueue = (name: string) => {
  return getQueueService(name, {
    backoff: {
      minDelay: 1,
      maxDelay: 1
    },
    deadLetter: {
      maxAttempts: 2
    },
    subscriptions: [
      getProbeSubscription({
        idempotency: {
          key: ['id'],
          ttl: TTL
        }
      })
    ]
  });
};

describe('local queue idempotency', () => {
  before(() => loadProbe());

  it('assert :: a key that already ran is acknowledged without running the handler again', async (t) => {
    const probe = useQueueProbe(t);

    const { client } = await startQueue(t, getIdempotentQueue('onceQueue'));

    await client.sendMessage({ id: 'a' });
    await waitFor(() => probe.requests.length === 1);

    await client.sendMessage({ id: 'a' });
    await client.sendMessage({ id: 'b' });

    await QueueTester.waitForDrain('onceQueue');

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['b', 1]
    ]);
  });

  it('assert :: a failed handler frees the key and the next attempt runs it', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    let failures = 1;

    probe.setHandler(() => {
      if (failures-- > 0) {
        throw new Error('The provider failed.');
      }
    });

    const { client } = await startQueue(t, getIdempotentQueue('failedQueue'));

    await client.sendMessage({ id: 'a' });
    await waitFor(() => probe.requests.length === 1);

    await clock.advance(1000);
    await waitFor(() => probe.requests.length === 2);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['a', 2]
    ]);
  });

  it('assert :: an unknown outcome keeps the key and consumes the message', async (t) => {
    const probe = useQueueProbe(t);

    probe.setHandler(() => {
      const error = new Error('The request timed out after it was sent.');

      error.name = 'UnknownOutcomeError';

      throw error;
    });

    const { client } = await startQueue(t, getIdempotentQueue('unknownQueue'));

    await client.sendMessage({ id: 'a' });
    await waitFor(() => probe.requests.length === 1);

    await client.sendMessage({ id: 'a' });

    await QueueTester.waitForDrain('unknownQueue');

    deepEqual(probe.getRuns(), [['a', 1]]);
    deepEqual(QueueTester.getDeadLetterMessages('unknownQueue'), []);
  });

  it('assert :: a key runs again once its ttl has passed', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    const { client } = await startQueue(t, getIdempotentQueue('ttlQueue'));

    await client.sendMessage({ id: 'a' });
    await waitFor(() => probe.requests.length === 1);

    await clock.advance(TTL * 1000 - 1);

    await client.sendMessage({ id: 'a' });
    await QueueTester.waitForDrain('ttlQueue');

    equal(probe.requests.length, 1);

    await clock.advance(1);

    await client.sendMessage({ id: 'a' });
    await waitFor(() => probe.requests.length === 2);
  });
});
