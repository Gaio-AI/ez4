import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  id: string;
  group: string;
}

// A standard queue gives its handlers a request they can defer.
export declare class TestStandardQueue extends Queue.Unordered<TestMessage> {
  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof deferringHandler;
    }>,

    Queue.UseSubscription<{
      handler: typeof plainHandler;
    }>
  ];
}

// A FIFO queue doesn't, so a handler that defers doesn't fit it.
export declare class TestFifoQueue extends Queue.Ordered<TestMessage> {
  fifoMode: Queue.UseFifoMode<{
    groupId: 'group';
  }>;

  // @ts-expect-error A deferring handler on a FIFO queue.
  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof deferringHandler;
    }>
  ];
}

export declare class TestPlainFifoQueue extends Queue.Ordered<TestMessage> {
  fifoMode: Queue.UseFifoMode<{
    groupId: 'group';
  }>;

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof plainHandler;
    }>
  ];
}

// The same holds for an imported queue, by the mode of the queue it imports.
export declare class TestStandardImport extends Queue.Import<TestStandardQueue> {
  project: 'name from project in ez4.project.js';

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof deferringHandler;
    }>
  ];
}

export declare class TestFifoImport extends Queue.Import<TestPlainFifoQueue> {
  project: 'name from project in ez4.project.js';

  // @ts-expect-error A deferring handler on an imported FIFO queue.
  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof deferringHandler;
    }>
  ];
}

export async function deferringHandler(request: Queue.DeferrableIncoming<TestMessage>) {
  await request.defer({ delay: 60 });
}

export function plainHandler(_request: Queue.Incoming<TestMessage>) {}
