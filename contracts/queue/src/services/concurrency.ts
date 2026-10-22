import type { QueueMessage } from './message';

/**
 * Subscription concurrency per key options.
 */
export interface QueueKeyConcurrency<T extends QueueMessage> {
  /**
   * Name of the message field, or fields, whose values together name who the limit is for, such as the account
   * whose provider quota the handler spends. Each one must be a required field.
   */
  readonly key: keyof T | (keyof T)[];

  /**
   * Maximum number of messages with the same key running at once, across every execution of the subscription.
   */
  readonly max: number;
}
