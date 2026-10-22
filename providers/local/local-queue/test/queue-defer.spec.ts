import { deepEqual, equal } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { createGate, getProbeSubscription, getQueueService, loadProbe, startQueue, useQueueProbe } from './queue';
import { settle, useTestClock, waitFor } from './clock';

describe('local queue defer and key concurrency', () => {
  before(() => loadProbe());

  it('assert :: a deferred message comes back after its delay as a new first attempt', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setHandler(async (request) => {
      if (probe.requests.length === 1) {
        await request.defer({ delay: 60 });
      }
    });

    const { client } = await startQueue(t, getQueueService('deferQueue'));

    await client.sendMessage({ id: 'a' });
    await waitFor(() => probe.requests.length === 1);

    await clock.advance(59_999);

    equal(probe.requests.length, 1);

    await clock.advance(1);
    await waitFor(() => probe.requests.length === 2);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['a', 1]
    ]);
  });

  it('assert :: a delay above 900 seconds comes back once it is due', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setHandler(async (request) => {
      if (probe.requests.length === 1) {
        await request.defer({ delay: 1000 });
      }
    });

    const { client } = await startQueue(t, getQueueService('longDeferQueue'));

    await client.sendMessage({ id: 'a' });
    await waitFor(() => probe.requests.length === 1);

    // The copy comes back after the longest wait and waits the rest without running.
    await clock.advance(900_000);
    await settle();

    equal(probe.requests.length, 1);

    await clock.advance(100_000);
    await waitFor(() => probe.requests.length === 2);

    equal(probe.requests.length, 2);
  });

  it('assert :: a message of a fifo queue cannot be deferred', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setHandler(async (request) => {
      if (request.attempt === 1) {
        await request.defer({ delay: 60 });
      }
    });

    const { client } = await startQueue(
      t,
      getQueueService('fifoDeferQueue', {
        fifoMode: {
          groupId: 'group'
        },
        backoff: {
          minDelay: 1,
          maxDelay: 1
        }
      })
    );

    await client.sendMessage({ id: 'a', group: 'g' });
    await waitFor(() => probe.requests.length === 1);

    await clock.advance(1000);
    await waitFor(() => probe.requests.length === 2);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['a', 2]
    ]);
  });

  it('assert :: a key runs at most its max messages at once, the others wait their turn', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);
    const gate = createGate();

    probe.setHandler(async (request) => {
      if (request.message.note === 'first') {
        await gate.promise;
      }
    });

    const { client } = await startQueue(
      t,
      getQueueService('slotQueue', {
        subscriptions: [
          getProbeSubscription({
            batch: 1,
            concurrency: 2,
            keyConcurrency: {
              key: ['id'],
              max: 1
            }
          })
        ]
      })
    );

    await client.sendMessage({ id: 'a', note: 'first' });
    await waitFor(() => probe.requests.length === 1);

    await client.sendMessage({ id: 'a', note: 'second' });
    await client.sendMessage({ id: 'b', note: 'other key' });
    await waitFor(() => probe.requests.length === 2);

    // The other key runs; the second message of the held key waits without running.
    deepEqual(
      probe.requests.map(({ message }) => message.note),
      ['first', 'other key']
    );

    gate.open();

    await clock.advance(30_000);
    await waitFor(() => probe.requests.length === 3);

    deepEqual(
      probe.requests.map(({ message, attempt }) => [message.note, attempt]),
      [
        ['first', 1],
        ['other key', 1],
        ['second', 1]
      ]
    );
  });
});
