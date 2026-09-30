import { deepEqual, rejects } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { MissingMessageGroupError } from '@ez4/queue/utils';

import { createGate, getQueueService, loadProbe, registerQueue, startQueue, useQueueProbe } from './queue';
import { settle, useTestClock, waitFor } from './clock';

describe('local queue fifo and fair modes', () => {
  before(() => loadProbe());

  it('assert :: reject a fifo message without its group', async (t) => {
    const { client } = await startQueue(
      t,
      getQueueService('fifoGroupQueue', {
        fifoMode: {
          groupId: 'group'
        }
      })
    );

    await rejects(() => client.sendMessage({ id: 'a' }), MissingMessageGroupError);
  });

  it('assert :: reject a fair message without its group', async (t) => {
    const { client } = await startQueue(
      t,
      getQueueService('fairGroupQueue', {
        fairMode: {
          groupId: 'group'
        }
      })
    );

    await rejects(() => client.sendMessage({ id: 'a' }), MissingMessageGroupError);
  });

  it('assert :: a duplicate unique id in the same group is accepted but not delivered', async (t) => {
    const probe = useQueueProbe(t);

    const { client } = await startQueue(
      t,
      getQueueService('uniqueIdQueue', {
        fifoMode: {
          groupId: 'group',
          uniqueId: 'id'
        }
      })
    );

    await client.sendMessage({ id: 'a', group: 'g', note: 'first' });
    await client.sendMessage({ id: 'a', group: 'g', note: 'second' });
    await client.sendMessage({ id: 'a', group: 'h' });

    await waitFor(() => probe.requests.length === 2);
    await settle();

    deepEqual(
      probe.requests.map(({ message }) => message),
      [
        { id: 'a', group: 'g', note: 'first' },
        { id: 'a', group: 'h' }
      ]
    );
  });

  it('assert :: without a unique id a duplicate body is accepted but not delivered', async (t) => {
    const probe = useQueueProbe(t);

    const { client } = await startQueue(
      t,
      getQueueService('contentQueue', {
        fifoMode: {
          groupId: 'group'
        }
      })
    );

    await client.sendMessage({ id: 'a', group: 'g' });
    await client.sendMessage({ id: 'a', group: 'g' });
    await client.sendMessage({ id: 'b', group: 'g' });

    await waitFor(() => probe.requests.length === 2);
    await settle();

    deepEqual(
      probe.requests.map(({ message }) => message.id),
      ['a', 'b']
    );
  });

  it('assert :: a unique id is delivered again once the five minute window ends', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    const { client } = await startQueue(
      t,
      getQueueService('windowQueue', {
        fifoMode: {
          groupId: 'group',
          uniqueId: 'id'
        }
      })
    );

    await client.sendMessage({ id: 'a', group: 'g' });

    await waitFor(() => probe.requests.length === 1);

    await clock.advance(299_999);
    await client.sendMessage({ id: 'a', group: 'g' });
    await settle();

    deepEqual(probe.getRuns(), [['a', 1]]);

    await clock.advance(1);
    await client.sendMessage({ id: 'a', group: 'g' });

    await waitFor(() => probe.requests.length === 2);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['a', 1]
    ]);
  });

  it('assert :: a group runs in order and a failure holds the rest of the group', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setHandler(({ message, attempt }) => {
      if (message.id === 'a1' && attempt === 1) {
        throw new Error('Handler failure.');
      }
    });

    const queue = registerQueue(
      t,
      getQueueService('orderQueue', {
        timeout: 20,
        fifoMode: {
          groupId: 'group'
        },
        backoff: {
          minDelay: 1,
          maxDelay: 1
        }
      })
    );

    await queue.client.sendMessage({ id: 'a1', group: 'a' });
    await queue.client.sendMessage({ id: 'a2', group: 'a' });
    await queue.client.sendMessage({ id: 'b1', group: 'b' });

    await queue.start();

    await waitFor(() => probe.requests.length === 2);

    // a1 is visible again after one second, but a2 is still in flight until the visibility timeout.
    await clock.advance(19_999);

    deepEqual(probe.getRuns(), [
      ['a1', 1],
      ['b1', 1]
    ]);

    await clock.advance(1);

    deepEqual(probe.getRuns(), [
      ['a1', 1],
      ['b1', 1],
      ['a1', 2],
      ['a2', 2]
    ]);
  });

  it('assert :: a group is not delivered while one of its messages is in flight', async (t) => {
    const probe = useQueueProbe(t);
    const gate = createGate();

    probe.setHandler(({ message }) => (message.id === 'a1' ? gate.promise : undefined));

    const { client } = await startQueue(
      t,
      getQueueService('inFlightQueue', {
        fifoMode: {
          groupId: 'group'
        }
      })
    );

    await client.sendMessage({ id: 'a1', group: 'a' });

    await waitFor(() => probe.requests.length === 1);

    await client.sendMessage({ id: 'a2', group: 'a' });
    await client.sendMessage({ id: 'b1', group: 'b' });

    await waitFor(() => probe.requests.length === 2);
    await settle();

    deepEqual(probe.getRuns(), [
      ['a1', 1],
      ['b1', 1]
    ]);

    gate.open();

    await waitFor(() => probe.requests.length === 3);

    deepEqual(probe.getRuns(), [
      ['a1', 1],
      ['b1', 1],
      ['a2', 1]
    ]);
  });

  it('assert :: retry holds the rest of the group', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setHandler(async ({ message, attempt, retry }) => {
      if (message.id === 'a1' && attempt === 1) {
        await retry({ delay: 5 });
      }
    });

    const queue = registerQueue(
      t,
      getQueueService('retryGroupQueue', {
        timeout: 20,
        fifoMode: {
          groupId: 'group'
        }
      })
    );

    await queue.client.sendMessage({ id: 'a1', group: 'a' });
    await queue.client.sendMessage({ id: 'a2', group: 'a' });

    await queue.start();

    await waitFor(() => probe.requests.length === 1);

    await clock.advance(19_999);

    deepEqual(probe.getRuns(), [['a1', 1]]);

    await clock.advance(1);

    deepEqual(probe.getRuns(), [
      ['a1', 1],
      ['a1', 2],
      ['a2', 2]
    ]);
  });
});
