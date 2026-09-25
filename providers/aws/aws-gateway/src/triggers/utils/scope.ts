import type { Runtime } from '@ez4/common';

type ScopeDeclaration = {
  scope?: Runtime.ScopeHeaders;
};

export const mergeScopeHeaders = (defaults: ScopeDeclaration, target: ScopeDeclaration) => {
  const scope = {
    ...defaults.scope,
    ...target.scope
  };

  // Undefined keeps the function hash of services without scope unchanged, so upgrading does not redeploy them.
  if (Object.keys(scope).length) {
    return scope;
  }

  return undefined;
};
