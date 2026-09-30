// The values @ez4/aws-queue deploys a queue and its handlers with, so a local queue runs like a deployed one.
export namespace Defaults {
  export const Timeout = 150;
  export const MaxAttempts = 3;
  export const MinBackoff = 5;
  export const MaxBackoff = 30;
  export const Retention = 20160;
  export const Batch = 10;
  export const Parallelism = 1;
  export const Delay = 0;
}
