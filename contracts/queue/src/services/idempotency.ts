import type { QueueMessage } from './message';

/**
 * Subscription idempotency options.
 */
export interface QueueIdempotency<T extends QueueMessage> {
  /**
   * Name of the message field, or fields, whose values together name one unit of work: the id of the
   * provider event, or the job and the contact it's for. Each one must be a required field.
   */
  readonly key: keyof T | (keyof T)[];

  /**
   * For how long (in seconds) a key that ran keeps a repeated message from running the handler again.
   */
  readonly ttl: number;
}
