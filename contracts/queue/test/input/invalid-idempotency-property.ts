import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  id: string;
}

export declare class TestQueue extends Queue.Unordered<TestMessage> {
  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof testHandler;
      idempotency: {
        key: 'id';
        ttl: 60;

        // No extra property is allowed.
        invalid_property: true;
      };
    }>
  ];
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}
