import type { QueueMessage } from './message';
import type { QueueRequest } from './request';

/**
 * Incoming message.
 */
export type QueueIncoming<T extends QueueMessage> = QueueRequest & {
  /**
   * Message payload.
   */
  readonly message: T;

  /**
   * Retry the incoming message using the given retry options.
   *
   * **IMPORTANT**: If the retry attempts exceed the maximum number of attempts
   * configured in the dead-letter, the message is moved to the dead-letter instead.
   *
   * @param options Retry options.
   */
  readonly retry: (options?: QueueRetryOptions) => Promise<void>;
};

/**
 * Incoming message of a standard queue, which can also be put off. A FIFO queue gives its handlers `QueueIncoming`
 * instead, where a deferred copy would lose its place in the group, so a handler that defers doesn't fit one.
 */
export type QueueDeferrableIncoming<T extends QueueMessage> = QueueIncoming<T> & {
  /**
   * Put the incoming message off without spending an attempt: a copy goes back to the queue with the delay and
   * this delivery is consumed. For waits that aren't failures, such as a provider's rate limit or quota.
   *
   * **IMPORTANT**: A message is deferred at most 20 times (each wait of up to 900 seconds counts once), after which
   * it fails like with an error.
   *
   * @param options Defer options.
   */
  readonly defer: (options: QueueDeferOptions) => Promise<void>;
};

export type QueueDeferOptions = {
  /**
   * Time (in seconds) before the message is delivered again.
   */
  delay: number;
};

export type QueueRetryOptions = {
  /**
   * Optional delay time (in seconds) for making the message available.
   * If no delay is specified, the default backoff configuration for the queue is used.
   */
  delay?: number;
};
