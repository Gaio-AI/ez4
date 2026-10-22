import type { ArchitectureType, LogLevel, RuntimeType } from '@ez4/project';
import type { LinkedVariables } from '@ez4/project/library';
import type { QueueSubscriptionListener } from './listener';
import type { QueueIdempotency } from './idempotency';
import type { QueueKeyConcurrency } from './concurrency';
import type { QueueDeferrableIncoming, QueueIncoming } from './incoming';
import type { QueueSubscriptionHandler } from './handler';
import type { QueueMessage } from './message';
import type { Queue } from './contract';

/**
 * The request the handlers of a queue in the given mode receive: only a standard queue's can be deferred. Checked
 * as a whole (not per union member), so a mode left open (`any`, as in constraints) takes every handler.
 */
export type QueueModeIncoming<T extends QueueMessage, U extends Queue.Mode> = [U] extends [{ fairMode: true }]
  ? QueueDeferrableIncoming<T>
  : QueueIncoming<T>;

/**
 * Queue subscription.
 */
export interface QueueSubscription<T extends QueueMessage, U extends Queue.Mode = { fairMode: true }> {
  /**
   * Life-cycle listener function for the subscription.
   */
  readonly listener?: QueueSubscriptionListener<T>;

  /**
   * Entry-point handler function for the subscription. A handler that defers its messages declares
   * `Queue.DeferrableIncoming`, which only a standard queue gives.
   */
  readonly handler: QueueSubscriptionHandler<T, QueueModeIncoming<T, U>>;

  /**
   * Maximum number of messages per handler invocation. A FIFO queue takes at most 10.
   */
  readonly batch?: number;

  /**
   * Maximum number of concurrent executions handlers.
   */
  readonly concurrency?: number;

  /**
   * Maximum number of messages one handler execution processes at the same time. Messages from the
   * same group in a FIFO queue still run one after another.
   *
   * It overlaps only the waits of work that doesn't share a connection: when every message goes
   * through the same single connection (a database client with a pool of one, for instance), the
   * messages wait for each other on it and a parallelism above one changes nothing.
   */
  readonly parallelism?: number;

  /**
   * How a handler execution acknowledges the messages of its batch.
   *
   * - `record` (default): each message of a batch is deleted from the queue as soon as it's
   *   handled, so an execution that dies on a later message doesn't run the earlier ones again.
   * - `batch`: no message is deleted on its own; once the execution returns, the queue deletes the
   *   whole batch together, except the messages that failed or were handed back. It saves a delete
   *   request per message, but an execution that dies (timeout, crash) or fails after some messages
   *   ran gets the whole batch back: those messages run again, each one spending another attempt
   *   toward the dead-letter queue. Only for idempotent handlers.
   */
  readonly acknowledge?: 'record' | 'batch';

  /**
   * Run the handler once per key while the key is kept, however many times the queue delivers it:
   *
   * - a message whose key already ran is acknowledged without running the handler;
   * - a message whose key is running in another execution goes back to the queue;
   * - a handler that fails or calls `retry` frees the key for the next attempt;
   * - a handler that throws `UnknownOutcomeError` (its work may or may not have happened) keeps the key
   *   and the message is consumed, so it runs neither again nor twice.
   */
  readonly idempotency?: QueueIdempotency<T>;

  /**
   * Run at most `max` messages with the same key at once: a message whose key has no free slot is deferred for a
   * few seconds instead of running, without spending an attempt. For a limit per tenant, such as one account's
   * share of a provider quota. Not available on a FIFO queue, where a deferred copy would lose its place.
   */
  readonly keyConcurrency?: QueueKeyConcurrency<T>;

  /**
   * Variables associated to the subscription.
   */
  readonly variables?: LinkedVariables;

  /**
   * Log retention (in days) for the handler.
   */
  readonly logRetention?: number;

  /**
   * Log level for the handler.
   */
  readonly logLevel?: LogLevel;

  /**
   * Architecture for the handler.
   */
  readonly architecture?: ArchitectureType;

  /**
   * Runtime for the handler.
   */
  readonly runtime?: RuntimeType;

  /**
   * Amount of memory available (in megabytes) for the handler.
   */
  readonly memory?: number;

  /**
   * Additional resource files for the handler bundler.
   */
  readonly files?: string[];

  /**
   * Determine whether the debug mode is active for the handler.
   */
  readonly debug?: boolean;

  /**
   * Determines whether or not VPC is enabled for the handler.
   */
  readonly vpc?: boolean;
}
