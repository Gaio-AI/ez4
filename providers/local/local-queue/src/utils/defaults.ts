import type { QueueSubscriptionAcknowledge } from '@ez4/queue/library';

// The values @ez4/aws-queue deploys a queue and its handlers with, so a local queue runs like a deployed one.
// The retry window a deployed queue without backoff spreads its retries over stays out: a local retry comes back
// within the backoff bounds, so a local run or a test sees every attempt in seconds.
export namespace Defaults {
  export const Timeout = 150;
  export const MaxAttempts = 3;
  export const MinBackoff = 5;
  export const MaxBackoff = 30;
  export const Retention = 20160;
  export const Batch = 10;
  export const Parallelism = 1;
  export const Acknowledge: QueueSubscriptionAcknowledge = 'record';
  export const Delay = 0;
}
