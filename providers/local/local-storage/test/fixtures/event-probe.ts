import type { Bucket } from '@ez4/storage';

declare global {
  var observeObjectEvent: ((request: Bucket.Incoming) => void) | undefined;
}

export const probeObjectEvent = (request: Bucket.Incoming) => {
  globalThis.observeObjectEvent?.(request);
};
