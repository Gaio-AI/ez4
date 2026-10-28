import type { Queue } from '@ez4/queue';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QueueTester } from '../src/service/tester';

declare class TaskMessage implements Queue.Message {
  taskId: string;
  groupId: string;
}

declare class DeferringQueue extends Queue.Unordered<TaskMessage> {
  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof deferTask;
    }>
  ];
}

declare class OrderedQueue extends Queue.Ordered<TaskMessage> {
  fifoMode: Queue.UseFifoMode<{
    groupId: 'groupId';
  }>;

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof runTask;
    }>
  ];
}

declare function deferTask(request: Queue.DeferrableIncoming<TaskMessage>): Promise<void>;
declare function runTask(request: Queue.Incoming<TaskMessage>): Promise<void>;

// Typed against the queue it names, so each one compiles only when the tester takes that queue.
type DeferringIncoming = Awaited<ReturnType<typeof QueueTester.incoming<DeferringQueue>>>;
type DeferringClient = ReturnType<typeof QueueTester.getClientMock<DeferringQueue>>;
type OrderedClient = ReturnType<typeof QueueTester.getClientMock<OrderedQueue>>;
type UntypedClient = ReturnType<typeof QueueTester.getClientMock>;

describe('local queue tester types', () => {
  it('assert :: takes a standard queue whose handler defers, typed by its message', () => {
    const message: DeferringIncoming['message'] = { taskId: 'a', groupId: 'g' };

    // @ts-expect-error The message keeps the queue's schema rather than widening to any.
    const unknownField: DeferringIncoming['message'] = { taskId: 'a', groupId: 'g', extra: true };

    equal(message.taskId, unknownField.taskId);
  });

  it('assert :: types each client in the mode of its queue', () => {
    const standardOptions: Parameters<DeferringClient['sendMessage']>[1] = { delay: 5 };
    const untypedOptions: Parameters<UntypedClient['sendMessage']>[1] = { delay: 5 };

    // @ts-expect-error A FIFO queue's client takes no send options.
    const fifoOptions: Parameters<OrderedClient['sendMessage']>[1] = { delay: 5 };

    deepEqual([standardOptions, untypedOptions, fifoOptions], [{ delay: 5 }, { delay: 5 }, { delay: 5 }]);
  });
});
