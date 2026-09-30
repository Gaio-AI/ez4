import { Runtime } from '@ez4/common';

export type ObservedScope = {
  scope: Runtime.Scope | undefined;
  headers: Runtime.ScopeHeaders;
  traceId?: string;
};

type ProbeRequest = {
  traceId?: string;
};

declare global {
  var observeScope: ((observed: ObservedScope) => void) | undefined;
  var scopeGate: ((name: string) => Promise<void>) | undefined;
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

// Waits at the gate until every concurrent invocation has set its scope, then reports the scope it sees.
const probeAfterGate = async (name: string, request: ProbeRequest) => {
  await globalThis.scopeGate?.(name);

  globalThis.observeScope?.({
    scope: Runtime.getScope(),
    headers: Runtime.getScopeHeaders(),
    traceId: request.traceId
  });

  return {
    status: 204,
    identity: {
      id: 'probe'
    }
  };
};

export const probeConcurrentScope = (request: ProbeRequest) => probeAfterGate('handler', request);

export const probeConcurrentAuthorizer = (request: ProbeRequest) => probeAfterGate('authorizer', request);
