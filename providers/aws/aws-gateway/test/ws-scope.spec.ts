import { deepEqual, notEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Runtime } from '@ez4/common';

import { apiEntryPoint as connectionEntryPoint } from '../lib/connection';
import { apiEntryPoint as authorizerEntryPoint } from '../lib/authorizer';
import { lambdaContext, setEntryPointGlobals } from './common/entry-point';

type ConnectionEvent = Parameters<typeof connectionEntryPoint>[0];
type AuthorizerEvent = Parameters<typeof authorizerEntryPoint>[0];

describe('gateway ws scope', () => {
  const scopeHeaders = {
    clientVersion: 'x-client-version',
    sessionId: 'x-session-id'
  };

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
});
