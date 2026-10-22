import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  id: string;
}

export declare class TestQueue extends Queue.Unordered<TestMessage> {
  // @ts-expect-error Missing idempotency ttl.
  subscriptions: [
    {
      handler: typeof testHandler;
      idempotency: {
        key: 'id';
      };
    }
  ];
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}
