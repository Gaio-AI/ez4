import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  id: string;
  group: string;
}

export declare class TestQueue extends Queue.Ordered<TestMessage> {
  fifoMode: Queue.UseFifoMode<{
    groupId: 'group';
  }>;

  subscriptions: [
    // A FIFO queue doesn't take a limit per key.
    Queue.UseSubscription<{
      handler: typeof testHandler;
      keyConcurrency: {
        key: 'id';
        max: 1;
      };
    }>
  ];
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}
