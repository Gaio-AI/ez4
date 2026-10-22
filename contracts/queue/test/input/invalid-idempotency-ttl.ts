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
        ttl: 0;
      };
    }>
  ];
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}
