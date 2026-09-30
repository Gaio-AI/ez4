import type { LocalQueue, ReceivedMessage } from './queue';

import { Logger } from '@ez4/logger';

import { AsyncResource } from 'node:async_hooks';

export type QueuePollerParameters = {
  batchSize: number;
  batchWindow: number;
  concurrency?: number;
  processBatch: (messages: ReceivedMessage[], signal: AbortSignal) => Promise<void>;
};

export type QueuePoller = {
  isIdle: () => boolean;
  stop: () => void;
};

// Takes messages from the queue like the Lambda event source mapping: in batches up to the batch size,
// waiting up to the batching window to fill one, with at most `concurrency` batches in flight.
export const startQueuePoller = (queue: LocalQueue, parameters: QueuePollerParameters): QueuePoller => {
  const { batchSize, batchWindow, concurrency } = parameters;

  const activeBatches = new Set<AbortController>();

  let pendingMessages: ReceivedMessage[] = [];
  let windowTimer: NodeJS.Timeout | undefined;

  let isStopped = false;

  const hasCapacity = () => {
    return !concurrency || activeBatches.size < concurrency;
  };

  // A batch holds its place until it finishes or reaches its timeout, then the queue is polled again.
  const dispatchBatch = (messages: ReceivedMessage[]) => {
    const controller = new AbortController();

    activeBatches.add(controller);

    parameters
      .processBatch(messages, controller.signal)
      .catch((error) => {
        Logger.error(`${error}`);
      })
      .finally(() => {
        activeBatches.delete(controller);
        queue.notify();
      });
  };

  const dispatchPending = () => {
    const messages = pendingMessages;

    clearTimeout(windowTimer);

    windowTimer = undefined;
    pendingMessages = [];

    dispatchBatch(messages);
  };

  const pollQueue = () => {
    while (!isStopped && hasCapacity()) {
      const messages = queue.receiveMessages(batchSize - pendingMessages.length);

      if (!messages.length) {
        return;
      }

      if (!batchWindow) {
        dispatchBatch(messages);
        continue;
      }

      pendingMessages.push(...messages);

      if (pendingMessages.length < batchSize) {
        if (!windowTimer) {
          windowTimer = setTimeout(dispatchPending, batchWindow * 1000);
          windowTimer.unref();
        }

        return;
      }

      dispatchPending();
    }
  };

  // The queue calls its listeners in the async context of whatever changed it, like a send. Bound to the context it
  // started in, the poller keeps the invocation of a sender, with its client overrides, out of a batch that carries
  // messages from other senders too.
  const unsubscribe = queue.subscribe(AsyncResource.bind(pollQueue));

  pollQueue();

  return {
    isIdle: () => {
      return !activeBatches.size && !pendingMessages.length;
    },
    stop: () => {
      isStopped = true;

      unsubscribe();
      clearTimeout(windowTimer);

      windowTimer = undefined;
      pendingMessages = [];

      activeBatches.forEach((controller) => controller.abort());
    }
  };
};
