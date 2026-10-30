import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  accountId: string;
  connectionId: string;
  note?: string;
}

export declare class TestQueue extends Queue.Unordered<TestMessage> {
  subscriptions: [
    // One field names who the limit is for.
    Queue.UseSubscription<{
      handler: typeof testHandler;
      keyConcurrency: {
        key: 'accountId';
        max: 1;
      };
    }>,
    // Two fields name it together.
    Queue.UseSubscription<{
      handler: typeof otherHandler;
      keyConcurrency: Queue.UseKeyConcurrency<{
        key: ['accountId', 'connectionId'];
        max: 3;
      }>;
    }>,
    // Subscription reference.
    TestSubscription
  ];
}

declare class TestKeyConcurrency implements Queue.KeyConcurrency<TestMessage> {
  key: 'connectionId';
  max: 2;
}

declare class TestSubscription implements Queue.Subscription<TestMessage> {
  handler: typeof thirdHandler;
  keyConcurrency: TestKeyConcurrency;
}

export async function testHandler(request: Queue.DeferrableIncoming<TestMessage>) {
  // Ensure defer types.
  await request.defer({ delay: 60 });
}

export function otherHandler(_request: Queue.Incoming<TestMessage>) {}

export function thirdHandler(_request: Queue.Incoming<TestMessage>) {}
