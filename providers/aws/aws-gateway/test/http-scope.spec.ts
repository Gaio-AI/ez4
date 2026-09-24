import type { EntryStates } from '@ez4/state';

import { deepEqual, equal, notEqual } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createLogGroup } from '@ez4/aws-logs';
import { createRole } from '@ez4/aws-identity';
import { Runtime } from '@ez4/common';

import { apiEntryPoint as requestEntryPoint } from '../lib/request';
import { apiEntryPoint as authorizerEntryPoint } from '../lib/authorizer';
import { createAuthorizerFunction } from '../src/authorizer/function/service';
import { createIntegrationFunction } from '../src/integration/function/service';
import { IntegrationFunctionType } from '../src/integration/function/types';
import { mergeScopeHeaders } from '../src/triggers/utils/scope';
import { lambdaContext, setEntryPointGlobals } from './common/entry-point';
import { getRoleDocument } from './common/role';

type RequestEvent = Parameters<typeof requestEntryPoint>[0];
type AuthorizerEvent = Parameters<typeof authorizerEntryPoint>[0];

describe('gateway http scope', () => {
  const scopeHeaders = {
    clientVersion: 'X-Client-Version',
    sessionId: 'x-session-id'
  };

  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: merge route scope over defaults', () => {
    const scope = mergeScopeHeaders(
      { scope: { clientVersion: 'x-client-version', sessionId: 'x-session-id' } },
      { scope: { sessionId: 'x-route-session-id' } }
    );

    deepEqual(scope, {
      clientVersion: 'x-client-version',
      sessionId: 'x-route-session-id'
    });

    equal(mergeScopeHeaders({}, {}), undefined);
  });

  it('assert :: scope changes the function hash', async () => {
    const state: EntryStates = {};

    const role = createRole(state, [], {
      roleName: 'ez4-test-scope-role',
      roleDocument: getRoleDocument()
    });

    const logGroup = createLogGroup(state, {
      groupName: 'ez4-test-scope-logs',
      retention: 1
    });

    const getIntegrationHash = (functionName: string, scope?: Runtime.ScopeHeaders) => {
      const { parameters } = createIntegrationFunction(state, role, logGroup, {
        functionName,
        type: IntegrationFunctionType.HttpRequest,
        architecture: ArchitectureType.Arm,
        runtime: RuntimeType.Node24,
        variables: [],
        memory: 128,
        timeout: 5,
        handler: {
          sourceFile: 'test/files/lambda.js',
          functionName: 'main',
          dependencies: []
        },
        scope
      });

      return parameters.getFunctionHash();
    };

    const getAuthorizerHash = (functionName: string, scope?: Runtime.ScopeHeaders) => {
      const { parameters } = createAuthorizerFunction(state, role, logGroup, {
        functionName,
        architecture: ArchitectureType.Arm,
        runtime: RuntimeType.Node24,
        variables: [],
        memory: 128,
        timeout: 5,
        authorizer: {
          sourceFile: 'test/files/lambda.js',
          functionName: 'main',
          dependencies: []
        },
        scope
      });

      return parameters.getFunctionHash();
    };

    equal(await getIntegrationHash('ez4-test-scope-a'), await getIntegrationHash('ez4-test-scope-b'));
    notEqual(await getIntegrationHash('ez4-test-scope-c'), await getIntegrationHash('ez4-test-scope-d', scopeHeaders));

    equal(await getAuthorizerHash('ez4-test-scope-e'), await getAuthorizerHash('ez4-test-scope-f'));
    notEqual(await getAuthorizerHash('ez4-test-scope-g'), await getAuthorizerHash('ez4-test-scope-h', scopeHeaders));
  });

  it('assert :: request captures declared headers', async () => {
    let scope: Runtime.Scope | undefined;

    setEntryPointGlobals(scopeHeaders, async () => {
      scope = Runtime.getScope();
      return { status: 204 };
    });

    const event = {
      headers: {
        'x-trace-id': 'trace-1',
        'x-client-version': '1.2.3',
        'x-other': 'ignored'
      },
      queryStringParameters: {
        'x-session-id': 'query-session'
      },
      isBase64Encoded: false,
      requestContext: {
        timeEpoch: 0,
        http: {
          method: 'GET',
          path: '/test'
        }
      }
    };

    await requestEntryPoint(event as unknown as RequestEvent, lambdaContext);

    deepEqual(scope, {
      traceId: 'trace-1',
      clientVersion: '1.2.3'
    });

    deepEqual(Runtime.getScopeHeaders(), scopeHeaders);
  });

  it('assert :: request without declaration keeps trace only', async () => {
    let scope: Runtime.Scope | undefined;

    setEntryPointGlobals(undefined, async () => {
      scope = Runtime.getScope();
      return { status: 204 };
    });

    const event = {
      headers: {
        'x-trace-id': 'trace-2',
        'x-client-version': '1.2.3'
      },
      isBase64Encoded: false,
      requestContext: {
        timeEpoch: 0,
        http: {
          method: 'GET',
          path: '/test'
        }
      }
    };

    await requestEntryPoint(event as unknown as RequestEvent, lambdaContext);

    deepEqual(scope, { traceId: 'trace-2' });
    deepEqual(Runtime.getScopeHeaders(), {});
  });

  it('assert :: authorizer captures declared headers', async () => {
    let scope: Runtime.Scope | undefined;

    setEntryPointGlobals(scopeHeaders, async () => {
      scope = Runtime.getScope();
      return { identity: { id: 'user' } };
    });

    const event = {
      headers: {
        'x-trace-id': 'trace-3',
        'x-session-id': 'session-1'
      },
      routeArn: 'arn:aws:execute-api:us-east-1:000000000000:api/stage/GET/test',
      requestContext: {
        timeEpoch: 0,
        http: {
          method: 'GET',
          path: '/test'
        }
      }
    };

    await authorizerEntryPoint(event as unknown as AuthorizerEvent, lambdaContext);

    deepEqual(scope, {
      traceId: 'trace-3',
      sessionId: 'session-1'
    });
  });
});
