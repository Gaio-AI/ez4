import type { Queue } from '@ez4/queue';
import type { Service } from '@ez4/common';

export type QueueProbe = {
  handler: (request: Queue.Incoming<Queue.Message>) => Promise<void> | void;
  listener: (event: Service.AnyEvent<Queue.Incoming<Queue.Message>>) => Promise<void> | void;
};

declare global {
  var queueProbe: QueueProbe | undefined;
}

export const probeHandler = (request: Queue.Incoming<Queue.Message>) => {
  return globalThis.queueProbe?.handler(request);
};

export const probeListener = (event: Service.AnyEvent<Queue.Incoming<Queue.Message>>) => {
  return globalThis.queueProbe?.listener(event);
};
