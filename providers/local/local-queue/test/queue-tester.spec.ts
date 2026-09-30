import { deepEqual, equal, throws } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { Tester } from '@ez4/project/library';

import { QueueTester } from '../src/service/tester';
import { createGate, getQueueService, loadProbe, startQueue, useQueueProbe } from './queue';
import { settle, useTestClock, waitFor } from './clock';

describe('local queue tester', () => {
  before(() => loadProbe());

  it('assert :: wait until the consumer drained the queue', async (t) => {
    const probe = useQueueProbe(t);
    const gate = createGate();

    let handled = false;

    probe.setHandler(async () => {
      await gate.promise;
      handled = true;
    });

    const { client } = await startQueue(t, getQueueService('drainQueue'));

    await client.sendMessage({ id: 'a' });

    let drained = false;

    const waitDrain = QueueTester.waitForDrain('drainQueue').then(() => {
      drained = true;
    });

    await waitFor(() => probe.requests.length === 1);
    await settle();

    equal(drained, false);

    gate.open();

    await waitDrain;

    equal(handled, true);
    deepEqual(probe.events.at(-1)?.type, 'end');
  });

  it('assert :: drain waits for a delayed message', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    const { client } = await startQueue(t, getQueueService('drainDelayQueue'));

    await client.sendMessage({ id: 'a' }, { delay: 5 });

    let drained = false;

    QueueTester.waitForDrain('drainDelayQueue').then(() => {
      drained = true;
    });

    await clock.advance(4999);

    equal(drained, false);

    await clock.advance(1);
    await waitFor(() => drained);

    equal(drained, true);
    equal(probe.requests.length, 1);
  });

  it('assert :: dead-letter messages of a queue', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    probe.setHandler(() => {
      throw new Error('Handler failure.');
    });

    const { client } = await startQueue(
      t,
      getQueueService('testerDeadLetterQueue', {
        deadLetter: {
          maxAttempts: 1
        },
        backoff: {
          minDelay: 1,
          maxDelay: 1
        }
      })
    );

    await client.sendMessage({ id: 'a', note: 'first' });
    await client.sendMessage({ id: 'b' });

    await waitFor(() => probe.requests.length === 2);

    deepEqual(QueueTester.getDeadLetterMessages('testerDeadLetterQueue'), []);

    await clock.advance(1000);

    deepEqual(QueueTester.getDeadLetterMessages('testerDeadLetterQueue'), [{ id: 'a', note: 'first' }, { id: 'b' }]);

    await QueueTester.waitForDrain('testerDeadLetterQueue');
  });

  it('assert :: refuse a queue without a local emulator', (t) => {
    t.mock.method(Tester, 'getServiceClient', () => ({}));

    throws(() => QueueTester.getDeadLetterMessages('mockedQueue'), /mockedQueue/);
    throws(() => QueueTester.waitForDrain('mockedQueue'), /mockedQueue/);
  });
});
