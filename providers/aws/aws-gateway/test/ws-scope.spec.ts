import type { WsService } from '@ez4/gateway/library';
import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { EntryStates } from '@ez4/state';
import type { FunctionState } from '@ez4/aws-function';

import { deepEqual, equal, notEqual } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createRole } from '@ez4/aws-identity';
import { Runtime } from '@ez4/common';

import { createGateway } from '../src/gateway/service';
import { GatewayProtocol } from '../src/gateway/types';
import {
  getIntegrationConnectionFunction,
  getIntegrationDisconnectionFunction,
  getIntegrationMessageFunction
} from '../src/triggers/integration';

import { apiEntryPoint as connectionEntryPoint } from '../lib/connection';
import { apiEntryPoint as authorizerEntryPoint } from '../lib/authorizer';
import { lambdaContext, setEntryPointGlobals } from './common/entry-point';
import { getRoleDocument } from './common/role';

type ConnectionEvent = Parameters<typeof connectionEntryPoint>[0];
type AuthorizerEvent = Parameters<typeof authorizerEntryPoint>[0];

describe('gateway ws scope', () => {
  const scopeHeaders = {
    clientVersion: 'x-client-version',
    sessionId: 'x-session-id'
  };

  afterEach(() => {
    Runtime.clearScope();
  });

  const captured: { scope?: Runtime.Scope } = {};

  const captureScope = async () => {
    captured.scope = Runtime.getScope();
    return { identity: { id: 'user' } };
  };

  it('assert :: connection reads headers before query', async () => {
    setEntryPointGlobals(scopeHeaders, captureScope);

    const event = {
      headers: {
        'x-client-version': 'header-version'
      },
      queryStringParameters: {
        'x-client-version': 'query-version',
        'x-session-id': 'session-1',
        'x-trace-id': 'trace-query'
      },
      requestContext: {
        requestTimeEpoch: 0,
        connectionId: 'connection-1'
      }
    };

    const response = await connectionEntryPoint(event as unknown as ConnectionEvent, lambdaContext);

    deepEqual(captured.scope, {
      traceId: 'trace-query',
      clientVersion: 'header-version',
      sessionId: 'session-1'
    });

    deepEqual(response, {
      statusCode: 204,
      headers: {
        ['x-trace-id']: 'trace-query'
      }
    });
  });

  it('assert :: connection trace header wins over query', async () => {
    setEntryPointGlobals(scopeHeaders, captureScope);

    const event = {
      headers: {
        'x-trace-id': 'trace-header'
      },
      queryStringParameters: {
        'x-trace-id': 'trace-query'
      },
      requestContext: {
        requestTimeEpoch: 0,
        connectionId: 'connection-2'
      }
    };

    await connectionEntryPoint(event as unknown as ConnectionEvent, lambdaContext);

    deepEqual(captured.scope, { traceId: 'trace-header' });
  });

  it('assert :: ws authorizer falls back to query', async () => {
    setEntryPointGlobals(scopeHeaders, captureScope);

    const event = {
      headers: {},
      queryStringParameters: {
        'x-session-id': 'session-2',
        'x-trace-id': 'trace-authorizer'
      },
      methodArn: 'arn:aws:execute-api:us-east-1:000000000000:api/stage/$connect',
      requestContext: {
        requestTimeEpoch: 0
      }
    };

    await authorizerEntryPoint(event as unknown as AuthorizerEvent, lambdaContext);

    deepEqual(captured.scope, {
      traceId: 'trace-authorizer',
      sessionId: 'session-2'
    });
  });

  it('assert :: http authorizer ignores query', async () => {
    setEntryPointGlobals(scopeHeaders, captureScope);

    const event = {
      headers: {},
      queryStringParameters: {
        'x-session-id': 'session-3',
        'x-trace-id': 'trace-query'
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

    deepEqual(Object.keys(captured.scope ?? {}), ['traceId']);
    notEqual(captured.scope?.traceId, 'trace-query');
  });

  it('assert :: scope changes the connect function hash only', async () => {
    const state: EntryStates = {};

    const gatewayState = createGateway(state, {
      gatewayId: 'ez4-test-ws-scope',
      gatewayName: 'EZ4: Test ws scope',
      protocol: GatewayProtocol.WebSocket,
      routeKey: 'ez4/unknown'
    });

    const functionStates: Record<string, FunctionState> = {};

    const context = {
      role: createRole(state, [], {
        roleName: 'ez4-test-ws-scope-role',
        roleDocument: getRoleDocument()
      }),
      getServiceState: () => {
        throw new Error('Not found.');
      },
      setServiceState: (name: string, _options: DeployOptions, functionState: FunctionState) => {
        functionStates[name] = functionState;
      },
      getDependencyFiles: () => []
    } as unknown as EventContext;

    const options = { prefix: 'ez4', projectName: 'test', branchName: '' } as DeployOptions;

    const getFunctionHashes = async (name: string, scope?: Runtime.ScopeHeaders) => {
      const getTarget = (handlerName: string) => ({
        handler: {
          name: handlerName,
          file: 'test/files/lambda.js'
        }
      });

      const service = {
        type: '@ez4/ws',
        context: {},
        name,
        defaults: {
          scope
        },
        connect: getTarget('connect'),
        disconnect: getTarget('disconnect'),
        message: getTarget('message')
      } as unknown as WsService;

      getIntegrationConnectionFunction(state, service, gatewayState, service.connect, options, context);
      getIntegrationDisconnectionFunction(state, service, gatewayState, service.disconnect, options, context);
      getIntegrationMessageFunction(state, service, gatewayState, service.message, options, context);

      return {
        connect: await functionStates[`${name}-connect`].parameters.getFunctionHash(),
        disconnect: await functionStates[`${name}-disconnect`].parameters.getFunctionHash(),
        message: await functionStates[`${name}-message`].parameters.getFunctionHash()
      };
    };

    const unscoped = await getFunctionHashes('unscoped');
    const scoped = await getFunctionHashes('scoped', scopeHeaders);

    notEqual(scoped.connect, unscoped.connect);
    equal(scoped.disconnect, unscoped.disconnect);
    equal(scoped.message, unscoped.message);
  });
});
