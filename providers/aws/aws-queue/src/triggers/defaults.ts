import type { QueueSubscriptionAcknowledge } from '@ez4/queue/library';

import { FunctionDefaults } from '@ez4/aws-function';

export namespace Defaults {
  /**
   * Default function log level.
   */
  export const LogLevel = FunctionDefaults.LogLevel;

  /**
   * Default log retention in days.
   */
  export const LogRetention = FunctionDefaults.LogRetention;

  /**
   * Default function architecture.
   */
  export const Architecture = FunctionDefaults.Architecture;

  /**
   * Default function runtime.
   */
  export const Runtime = FunctionDefaults.Runtime;

  /**
   * Default function memory.
   */
  export const Memory = FunctionDefaults.Memory;

  /**
   * Default queue timeout.
   */
  export const Timeout = 150;

  /**
   * Default max attempts.
   */
  export const MaxAttempts = 3;

  /**
   * Default min delay (in seconds) for backoff.
   */
  export const MinBackoff = 5;

  /**
   * Default max delay (in seconds) for backoff.
   */
  export const MaxBackoff = 30;

  /**
   * Minimum time (in seconds) between the first and the last attempt of a queue that declares no backoff, long
   * enough for a database restart or failover to end before the message runs out of attempts.
   */
  export const RetryWindow = 600;

  /**
   * Default queue retention (14 days)
   */
  export const Retention = 20160;

  /**
   * Default queue batch size.
   */
  export const Batch = 10;

  /**
   * Default number of messages one handler execution processes at the same time.
   */
  export const Parallelism = 1;

  /**
   * Default acknowledge of the messages one handler execution processes.
   */
  export const Acknowledge: QueueSubscriptionAcknowledge = 'record';

  /**
   * Default queue delay.
   */
  export const Delay = 0;

  /**
   * Default queue long polling wait (in seconds).
   */
  export const Polling = 0;
}
