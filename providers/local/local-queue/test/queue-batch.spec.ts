import { deepEqual, equal, ok } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { QueueTester } from '../src/service/tester';
import { createGate, getProbeSubscription, getQueueService, loadProbe, registerQueue, startQueue, useQueueProbe } from './queue';
import { settle, useTestClock, waitFor } from './clock';

describe('local queue batches', () => {
  before(() => loadProbe());

  it('assert :: messages waiting in the queue arrive in one batch', async (t) => {
    const probe = useQueueProbe(t);

    const queue = registerQueue(t, getQueueService('batchQueue'));

    await queue.client.sendMessage({ id: 'a' });
    await queue.client.sendMessage({ id: 'b' });
    await queue.client.sendMessage({ id: 'c' });

    await queue.start();

    await waitFor(() => probe.requests.length === 3);

    equal(new Set(probe.requests.map(({ requestId }) => requestId)).size, 1);
    equal(probe.events.filter(({ type }) => type === 'begin').length, 1);
  });

  it('assert :: a standard queue waits for the batching window before a partial batch', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    const { client } = await startQueue(
      t,
      getQueueService('windowQueue', {
        subscriptions: [getProbeSubscription({ batch: 21 })]
      })
    );

    await client.sendMessage({ id: 'a' });
    await client.sendMessage({ id: 'b' });
    await client.sendMessage({ id: 'c' });

    await clock.advance(999);

    equal(probe.requests.length, 0);

    await clock.advance(1);

    equal(probe.requests.length, 3);
    equal(probe.events.filter(({ type }) => type === 'begin').length, 1);
  });

  it('assert :: a full batch goes without waiting for the batching window', async (t) => {
    useTestClock(t);

    const probe = useQueueProbe(t);

    const { client } = await startQueue(
      t,
      getQueueService('fullBatchQueue', {
        subscriptions: [getProbeSubscription({ batch: 21 })]
      })
    );

    for (let index = 0; index < 21; index++) {
      await client.sendMessage({ id: `${index}` });
    }

    await waitFor(() => probe.requests.length === 21);

    equal(probe.requests.length, 21);
    equal(probe.events.filter(({ type }) => type === 'begin').length, 1);
  });

  it('assert :: a fifo queue has no batching window', async (t) => {
    useTestClock(t);

    const probe = useQueueProbe(t);

    const queue = registerQueue(
      t,
      getQueueService('fifoWindowQueue', {
        subscriptions: [getProbeSubscription({ batch: 21 })],
        fifoMode: {
          groupId: 'group'
        }
      })
    );

    await queue.client.sendMessage({ id: 'a', group: 'a' });
    await queue.client.sendMessage({ id: 'b', group: 'b' });

    await queue.start();

    await waitFor(() => probe.requests.length === 2);

    equal(probe.requests.length, 2);
    equal(probe.events.filter(({ type }) => type === 'begin').length, 1);
  });

  it('assert :: concurrency limits the batches in flight', async (t) => {
    const probe = useQueueProbe(t);
    const gate = createGate();

    probe.setHandler(({ message }) => (message.id === 'a' ? gate.promise : undefined));

    const { client } = await startQueue(
      t,
      getQueueService('concurrencyQueue', {
        subscriptions: [getProbeSubscription({ batch: 1, concurrency: 1 })]
      })
    );

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.requests.length === 1);

    await client.sendMessage({ id: 'b' });
    await settle();

    deepEqual(probe.getRuns(), [['a', 1]]);

    gate.open();

    await waitFor(() => probe.requests.length === 2);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['b', 1]
    ]);
  });

  it('assert :: the records of a batch run one at a time by default', async (t) => {
    const probe = useQueueProbe(t);
    const gate = createGate();

    probe.setHandler(() => gate.promise);

    const queue = registerQueue(t, getQueueService('serialQueue'));

    await queue.client.sendMessage({ id: 'a' });
    await queue.client.sendMessage({ id: 'b' });
    await queue.client.sendMessage({ id: 'c' });

    await queue.start();

    await waitFor(() => probe.requests.length === 1);
    await settle();

    equal(probe.requests.length, 1);

    gate.open();

    await waitFor(() => probe.requests.length === 3);

    equal(probe.getMaxRunning(), 1);
  });

  it('assert :: parallelism runs that many records at the same time', async (t) => {
    const probe = useQueueProbe(t);
    const gate = createGate();

    probe.setHandler(() => gate.promise);

    const queue = registerQueue(
      t,
      getQueueService('parallelQueue', {
        subscriptions: [getProbeSubscription({ parallelism: 2 })]
      })
    );

    await queue.client.sendMessage({ id: 'a' });
    await queue.client.sendMessage({ id: 'b' });
    await queue.client.sendMessage({ id: 'c' });

    await queue.start();

    await waitFor(() => probe.requests.length === 2);
    await settle();

    equal(probe.requests.length, 2);

    gate.open();

    await waitFor(() => probe.requests.length === 3);

    equal(probe.getMaxRunning(), 2);
  });

  it('assert :: a record starts only while the time left covers the slowest record', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);
    const gate = createGate();

    probe.setHandler(({ message, attempt }) => (message.id === 'a' && attempt === 1 ? gate.promise : undefined));

    const queue = registerQueue(t, getQueueService('deadlineQueue', { timeout: 3 }));

    await queue.client.sendMessage({ id: 'a' });
    await queue.client.sendMessage({ id: 'b' });
    await queue.client.sendMessage({ id: 'c' });

    await queue.start();

    await waitFor(() => probe.requests.length === 1);

    // The first record takes 1.5s out of 3s, and one second is kept to report a timeout.
    await clock.advance(1500);

    gate.open();

    await settle();

    deepEqual(probe.getRuns(), [['a', 1]]);

    // The records handed back are visible again when their visibility timeout ends.
    await clock.advance(1500);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['b', 2],
      ['c', 2]
    ]);
  });

  it('assert :: a failed invocation hands every message back for its visibility timeout', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    let failInvocation = true;

    probe.setListener(({ type }) => {
      if (type === 'begin' && failInvocation) {
        failInvocation = false;
        throw new Error('Listener failure.');
      }
    });

    const { client } = await startQueue(t, getQueueService('invocationQueue', { timeout: 10 }));

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.events.some(({ type }) => type === 'end'));

    await clock.advance(9999);

    equal(probe.requests.length, 0);

    await clock.advance(1);

    deepEqual(probe.getRuns(), [['a', 2]]);
  });

  it('assert :: a message whose handler finished is consumed when a hook after it fails', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setListener(({ type }) => {
      if (type === 'done') {
        throw new Error('Listener failure.');
      }
    });

    const { client } = await startQueue(t, getQueueService('hookQueue', { timeout: 10 }));

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.events.some(({ type }) => type === 'end'));

    await clock.advance(60_000);

    deepEqual(probe.getRuns(), [['a', 1]]);

    await QueueTester.waitForDrain('hookQueue');
  });

  it('assert :: at the timeout the listener gets a timeout event and the message goes back', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);
    const gate = createGate();

    probe.setHandler(({ attempt }) => (attempt === 1 ? gate.promise : undefined));

    const { client } = await startQueue(t, getQueueService('timeoutQueue', { timeout: 2 }));

    await client.sendMessage({ id: 'a' });

    await waitFor(() => probe.requests.length === 1);

    await clock.advance(999);

    equal(probe.events.filter(({ type }) => type === 'timeout').length, 0);

    await clock.advance(1);

    const [timeoutEvent, ...otherEvents] = probe.events.filter(({ type }) => type === 'timeout');

    equal(otherEvents.length, 0);
    equal(timeoutEvent?.request.attempt, 1);

    await clock.advance(1000);

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['a', 2]
    ]);

    await QueueTester.waitForDrain('timeoutQueue');

    // The first attempt can't be stopped in-process, and finishing late changes nothing.
    gate.open();

    await settle();

    deepEqual(probe.getRuns(), [
      ['a', 1],
      ['a', 2]
    ]);
  });

  it('assert :: shutdown stops the pollers and their timers', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);
    const gate = createGate();

    probe.setHandler(() => gate.promise);

    const { emulator, client } = await startQueue(
      t,
      getQueueService('shutdownQueue', {
        subscriptions: [getProbeSubscription({ batch: 21 })]
      })
    );

    await client.sendMessage({ id: 'a' });

    // One batch running and another one waiting for its batching window.
    await clock.advance(1000);
    await client.sendMessage({ id: 'b' });
    await clock.advance(0);

    deepEqual(probe.getRuns(), [['a', 1]]);

    ok(clock.pendingTimers() > 0);

    await emulator.shutdownHandler?.();

    equal(clock.pendingTimers(), 0);

    await client.sendMessage({ id: 'c' });

    await clock.advance(300_000);

    deepEqual(probe.getRuns(), [['a', 1]]);
  });
});
