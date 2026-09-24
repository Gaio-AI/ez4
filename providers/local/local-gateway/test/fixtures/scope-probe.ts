import { Runtime } from '@ez4/common';

export type ObservedScope = {
  scope: Runtime.Scope | undefined;
  headers: Runtime.ScopeHeaders;
};

declare global {
  var observeScope: ((observed: ObservedScope) => void) | undefined;
}

export const probeScope = () => {
  globalThis.observeScope?.({
    scope: Runtime.getScope(),
    headers: Runtime.getScopeHeaders()
  });

  return {
    status: 204,
    identity: {
      id: 'probe'
    }
  };
};
