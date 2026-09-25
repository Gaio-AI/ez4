import type { Context } from 'aws-lambda';
import type { Runtime } from '@ez4/common';

export const lambdaContext = {
  awsRequestId: 'test-request-id',
  getRemainingTimeInMillis: () => 5000
} as Context;

export const setEntryPointGlobals = (scope: Runtime.ScopeHeaders | undefined, handle: () => Promise<unknown>) => {
  Object.assign(globalThis, {
    __EZ4_SCOPE: scope,
    __EZ4_HEADERS_SCHEMA: null,
    __EZ4_PARAMETERS_SCHEMA: null,
    __EZ4_QUERY_SCHEMA: null,
    __EZ4_IDENTITY_SCHEMA: null,
    __EZ4_BODY_SCHEMA: null,
    __EZ4_RESPONSE_SCHEMA: null,
    __EZ4_ERRORS_MAP: null,
    __EZ4_PREFERENCES: {},
    __EZ4_CONTEXT: {},
    dispatch: async () => {},
    handle
  });
};
