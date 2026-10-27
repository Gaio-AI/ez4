import type { Bucket } from '@ez4/storage';

import { Runtime } from '@ez4/common';

export type ObservedScope = {
  traceId: string | undefined;
  scope: Runtime.Scope | undefined;
};

declare global {
  var observeScope: ((observed: ObservedScope) => void) | undefined;
}

export const probeScopeLater = async (request: Bucket.Incoming) => {
  await new Promise((resolve) => setTimeout(resolve, 20));

  globalThis.observeScope?.({
    traceId: request.traceId,
    scope: Runtime.getScope()
  });
};
