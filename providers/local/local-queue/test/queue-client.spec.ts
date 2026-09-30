import type { TestMessage } from './queue';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { Runtime } from '@ez4/common';

import { QueueTester } from '../src/service/tester';
import { getQueueService, loadProbe, startQueue, useQueueProbe } from './queue';
import { useTestClock, waitFor } from './clock';

const SIZE_ERROR = {
  name: 'InvalidParameterValue',
  message: 'One or more parameters are invalid. Reason: Message must be shorter than 1048576 bytes.'
};

// The trace id and the scope go along as message attributes, and SQS counts them in the message size.
const TRACE_ATTRIBUTE_SIZE = 'EZ4.TRACE_ID'.length + 'String'.length + 36;

describe('local queue client', () => {
  before(() => loadProbe());

  it('assert :: refuse a message over 1 MiB', async (t) => {
    const { client } = await startQueue(t, getQueueService('sizeQueue', { subscriptions: [] }));

    await rejects(() => client.sendMessage({ id: 'x'.repeat(1048576) }), SIZE_ERROR);
  });

  it('assert :: the message size counts the trace attributes', async (t) => {
    const { client } = await startQueue(t, getQueueService('attributeSizeQueue', { subscriptions: [] }));

    // The JSON body is `{"id":"..."}`, 9 bytes around the id.
    const largestId = 1048576 - TRACE_ATTRIBUTE_SIZE - 9;

    await Runtime.runWithScope(async () => {
      Runtime.setScope({ traceId: 't'.repeat(36) });

      await client.sendMessage({ id: 'x'.repeat(largestId) });

      await rejects(() => client.sendMessage({ id: 'x'.repeat(largestId + 1) }), SIZE_ERROR);
    });
  });

  it('assert :: refuse a delay out of 0 to 900 seconds', async (t) => {
    const { client } = await startQueue(t, getQueueService('delayBoundsQueue', { subscriptions: [] }));

    const delayError = {
      name: 'InvalidParameterValue',
      message: /DelaySeconds/
    };

    await rejects(() => client.sendMessage({ id: 'a' }, { delay: 901 }), delayError);
    await rejects(() => client.sendMessage({ id: 'a' }, { delay: -1 }), delayError);

    await client.sendMessage({ id: 'a' }, { delay: 900 });
  });

  it('assert :: refuse a delay for one message of a fifo queue', async (t) => {
    const { client } = await startQueue(
      t,
      getQueueService('fifoDelayQueue', {
        subscriptions: [],
        fifoMode: {
          groupId: 'group'
        }
      })
    );

    await rejects(() => client.sendMessage({ id: 'a', group: 'g' }, { delay: 5 }), {
      name: 'InvalidParameterValue',
      message: /DelaySeconds/
    });
  });

  it('assert :: refuse a group id sqs refuses', async (t) => {
    const { client } = await startQueue(
      t,
      getQueueService('groupFormatQueue', {
        subscriptions: [],
        fifoMode: {
          groupId: 'group'
        }
      })
    );

    const groupError = {
      name: 'InvalidParameterValue',
      message: /MessageGroupId/
    };

    await rejects(() => client.sendMessage({ id: 'a', group: 'João Silva' }), groupError);
    await rejects(() => client.sendMessage({ id: 'a', group: 'g'.repeat(129) }), groupError);

    await client.sendMessage({ id: 'a', group: 'g'.repeat(128) });
  });

  it('assert :: a delayed message is delivered once its delay ends', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    const { client } = await startQueue(t, getQueueService('delayQueue'));

    await client.sendMessage({ id: 'a' }, { delay: 5 });

    await clock.advance(4999);

    equal(probe.requests.length, 0);

    await clock.advance(1);

    equal(probe.requests.length, 1);
  });

  it('assert :: the queue delay applies to a message without its own', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    const { client } = await startQueue(t, getQueueService('queueDelayQueue', { delay: 4 }));

    await client.sendMessage({ id: 'a' });

    await clock.advance(3999);

    equal(probe.requests.length, 0);

    await clock.advance(1);

    equal(probe.requests.length, 1);
  });

  it('assert :: receive visible messages and hide them for the visibility timeout', async (t) => {
    const clock = useTestClock(t);

    const { client } = await startQueue(t, getQueueService('receiveQueue', { subscriptions: [], timeout: 30 }));

    await client.sendMessage({ id: 'a' });
    await client.sendMessage({ id: 'b', note: 'second' });

    deepEqual(await client.receiveMessage({ messages: 10 }), [{ id: 'a' }, { id: 'b', note: 'second' }]);
    deepEqual(await client.receiveMessage({ messages: 10 }), []);

    await clock.advance(30_000);

    deepEqual(await client.receiveMessage(), [{ id: 'a' }]);
  });

  it('assert :: refuse receive options out of the sqs bounds', async (t) => {
    const { client } = await startQueue(t, getQueueService('receiveBoundsQueue', { subscriptions: [] }));

    await rejects(() => client.receiveMessage({ messages: 0 }), { name: 'InvalidParameterValue', message: /MaxNumberOfMessages/ });
    await rejects(() => client.receiveMessage({ messages: 11 }), { name: 'InvalidParameterValue', message: /MaxNumberOfMessages/ });
    await rejects(() => client.receiveMessage({ polling: 21 }), { name: 'InvalidParameterValue', message: /WaitTimeSeconds/ });
  });

  it('assert :: receive waits up to the polling time for a message', async (t) => {
    const clock = useTestClock(t);

    const { client } = await startQueue(t, getQueueService('pollingQueue', { subscriptions: [], polling: 3 }));

    const received = client.receiveMessage({ polling: 5 });

    await clock.advance(2000);
    await client.sendMessage({ id: 'a' });

    deepEqual(await received, [{ id: 'a' }]);

    let emptyResult: TestMessage[] | undefined;

    // Without a polling time of its own, the receive waits for the queue polling time.
    client.receiveMessage().then((messages) => {
      emptyResult = messages;
    });

    await clock.advance(2999);

    equal(emptyResult, undefined);

    await clock.advance(1);

    await waitFor(() => !!emptyResult);

    deepEqual(emptyResult, []);
  });

  it('assert :: every receive counts as an attempt', async (t) => {
    const clock = useTestClock(t);

    const { client } = await startQueue(
      t,
      getQueueService('receiveAttemptQueue', {
        subscriptions: [],
        timeout: 10,
        deadLetter: {
          maxAttempts: 1
        }
      })
    );

    await client.sendMessage({ id: 'a' });

    deepEqual(await client.receiveMessage(), [{ id: 'a' }]);

    await clock.advance(10_000);

    deepEqual(await client.receiveMessage(), []);
    deepEqual(QueueTester.getDeadLetterMessages('receiveAttemptQueue'), [{ id: 'a' }]);
  });
});
