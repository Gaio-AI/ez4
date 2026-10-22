import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  id: string;
}

// Concrete class is not allowed.
class TestIdempotency implements Queue.Idempotency<TestMessage> {
  key!: 'id';
  ttl!: 60;
}

export declare class TestQueue extends Queue.Unordered<TestMessage> {
  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof testHandler;
      idempotency: TestIdempotency;
    }>
  ];
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}
