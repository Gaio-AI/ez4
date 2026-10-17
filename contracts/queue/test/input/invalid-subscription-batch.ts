import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  id: string;
}

export declare class TestFifoQueue extends Queue.Ordered<TestMessage> {
  fifoMode: Queue.UseFifoMode<{
    groupId: 'id';
  }>;

  subscriptions: [
    // The largest batch a FIFO queue takes.
    Queue.UseSubscription<{
      handler: typeof testHandler;
      batch: 10;
    }>,

    // Too large for a FIFO queue.
    Queue.UseSubscription<{
      handler: typeof otherHandler;
      batch: 11;
    }>
  ];
}

export declare class TestStandardQueue extends Queue.Unordered<TestMessage> {
  subscriptions: [
    // A standard queue takes it.
    Queue.UseSubscription<{
      handler: typeof testHandler;
      batch: 11;
    }>
  ];
}

export declare class TestImportQueue extends Queue.Import<TestFifoQueue> {
  project: 'name from project in ez4.project.js';

  subscriptions: [
    // Too large for the FIFO queue it imports.
    Queue.UseSubscription<{
      handler: typeof testHandler;
      batch: 11;
    }>
  ];
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}

export function otherHandler(_request: Queue.Incoming<TestMessage>) {}
