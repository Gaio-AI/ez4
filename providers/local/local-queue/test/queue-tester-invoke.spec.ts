import type { AuditQueue, NotifyQueue, OrderQueue } from './fixtures/orders';

import { deepEqual, equal, match, rejects, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MalformedMessageError } from '@ez4/queue/utils';
import { Tester } from '@ez4/project/library';

import { QueueTester } from '../src/service/tester';
import { processOrder } from './fixtures/orders';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The fixture queues are shared by the whole run, so each test takes out only the messages of its own order.
const takeAuditMessages = async (orderId: string) => {
  const messages = await QueueTester.getClient<AuditQueue>('AuditQueue').receiveMessage({ messages: 10 });

  return messages.filter((message) => message.orderId === orderId);
};

const takeNotifications = async (orderId: string) => {
  const messages = await QueueTester.getClient<NotifyQueue>('NotifyQueue').receiveMessage({ messages: 10 });

  return messages.filter((message) => message.orderId === orderId);
};

describe('local queue tester invoke', () => {
  it('assert :: send a message through the queue emulator', async () => {
    const response = await QueueTester.send<OrderQueue>('OrderQueue', { orderId: 'send-1', customer: 'alice' });

    equal(response.status, 201);

    await QueueTester.waitForDrain('OrderQueue');

    deepEqual(await takeAuditMessages('send-1'), [{ orderId: 'send-1', action: 'placed' }]);
  });

  it('assert :: send a message the queue refuses', async () => {
    // @ts-expect-error The message type refuses it as well.
    const response = await QueueTester.send<OrderQueue>('OrderQueue', { orderId: 'send-2' });

    equal(response.status, 400);
    equal(JSON.parse(`${response.body}`).message, 'Malformed queue message payload.');

    const delayed = await QueueTester.send<OrderQueue>('OrderQueue', { orderId: 'send-3', customer: 'alice' }, { delay: 901 });

    equal(delayed.status, 400);
    match(JSON.parse(`${delayed.body}`).message, /DelaySeconds must be >= 0 and <= 900/);
  });

  it('assert :: a consumer runs out of the request that sent its message', async () => {
    const auditQueue = QueueTester.getClientMock<AuditQueue>('AuditQueue');

    const response = await Tester.request(
      'OrderQueue',
      {
        body: {
          orderId: 'scope-1',
          customer: 'bob'
        }
      },
      {
        services: {
          AuditQueue: auditQueue
        }
      }
    );

    equal(response.status, 201);

    await QueueTester.waitForDrain('OrderQueue');

    equal(auditQueue.sendMessage.mock.callCount(), 0);

    deepEqual(await takeAuditMessages('scope-1'), [{ orderId: 'scope-1', action: 'placed' }]);
  });

  it('assert :: incoming request of a message', async () => {
    const request = await QueueTester.incoming<OrderQueue>('OrderQueue', {
      orderId: 'incoming-1',
      customer: 'carol',
      // @ts-expect-error Not in the message type, and the schema drops it.
      extra: 'dropped'
    });

    deepEqual(request.message, { orderId: 'incoming-1', customer: 'carol' });

    match(request.requestId, UUID_PATTERN);
    match(request.traceId ?? '', UUID_PATTERN);

    equal(request.attempt, 1);
    equal(request.maxAttempts, 5);

    await request.retry({ delay: 10 });

    deepEqual(
      request.retry.mock.calls.map((call) => call.arguments),
      [[{ delay: 10 }]]
    );

    const auditRequest = await QueueTester.incoming<AuditQueue>('AuditQueue', { orderId: 'incoming-1', action: 'placed' });

    // Without a dead-letter queue, the attempts the runtime is deployed with.
    equal(auditRequest.maxAttempts, 3);
  });

  it('assert :: incoming request with overrides', async () => {
    const request = await QueueTester.incoming<OrderQueue>(
      'OrderQueue',
      {
        orderId: 'incoming-2',
        customer: 'carol'
      },
      {
        requestId: 'request-1',
        traceId: 'trace-1',
        attempt: 3,
        maxAttempts: 7,
        retry: async () => {}
      }
    );

    const { requestId, traceId, attempt, maxAttempts } = request;

    deepEqual({ requestId, traceId, attempt, maxAttempts }, { requestId: 'request-1', traceId: 'trace-1', attempt: 3, maxAttempts: 7 });

    await request.retry();

    equal(request.retry.mock.callCount(), 1);
  });

  it('assert :: incoming request of a message the runtime refuses', async () => {
    await rejects(
      // @ts-expect-error The message type refuses it as well.
      QueueTester.incoming<OrderQueue>('OrderQueue', { orderId: 'invalid-1', customer: null }),
      MalformedMessageError
    );

    await rejects(QueueTester.incoming('UnknownQueue', {}), /UnknownQueue/);
  });

  it('assert :: call a handler with its incoming request and context', async () => {
    const auditQueue = QueueTester.getClientMock<AuditQueue>('AuditQueue');

    const request = await QueueTester.incoming<OrderQueue>('OrderQueue', { orderId: 'direct-1', customer: 'dave' });
    const context = QueueTester.getContext<OrderQueue>('OrderQueue', { auditQueue });

    await processOrder(request, context);

    deepEqual(auditQueue.delivered, [{ orderId: 'direct-1', action: 'placed' }]);

    // Not overridden, so it's the real local queue.
    deepEqual(await takeNotifications('direct-1'), [{ orderId: 'direct-1' }]);

    throws(
      // @ts-expect-error Not a service the queue links.
      () => QueueTester.getContext<OrderQueue>('OrderQueue', { billingQueue: auditQueue }),
      /Context service 'billingQueue' not found/
    );
  });
});
