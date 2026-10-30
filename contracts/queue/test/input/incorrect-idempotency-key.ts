import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  id: string;
  note?: string;
}

export declare class TestQueue extends Queue.Unordered<TestMessage> {
  // @ts-expect-error Key field that isn't in the message.
  subscriptions: [
    // A field the message doesn't have.
    Queue.UseSubscription<{
      handler: typeof testHandler;
      idempotency: {
        key: ['id', 'missing'];
        ttl: 60;
      };
    }>,
    // An optional field can't name the unit of work.
    Queue.UseSubscription<{
      handler: typeof otherHandler;
      idempotency: {
        key: 'note';
        ttl: 60;
      };
    }>
  ];
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}

export function otherHandler(_request: Queue.Incoming<TestMessage>) {}
