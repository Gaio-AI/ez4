import type { EmulateServiceContext, EmulatorConnectionEvent, ServeOptions } from '@ez4/project/library';
import type { HttpService, WsService } from '@ez4/gateway/library';
import type { HttpClientRequest } from '@ez4/gateway';
import type { ObservedScope } from './fixtures/scope-probe';

import { deepEqual, equal, match, notEqual } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Runtime } from '@ez4/common';

import { registerHttpLocalService } from '../src/provider/http/local';
import { registerWsLocalService } from '../src/provider/ws/local';
import { createHttpServiceClient } from '../src/client/http/service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const options = {
  prefix: 'ez4',
  projectName: 'scope',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {}
} as ServeOptions;

const context = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

const probeHandler = {
  name: 'probeScope',
  file: 'test/fixtures/scope-probe.ts',
  position: [1, 1]
};

const observeScopes = (count: number) => {
  const observed: ObservedScope[] = [];

  return new Promise<ObservedScope[]>((resolve) => {
    globalThis.observeScope = (entry) => {
      observed.push(entry);

      if (observed.length === count) {
        resolve(observed);
      }
    };
  });
};

const getHttpService = (authorizer?: typeof probeHandler) => {
  return {
    name: 'scopeApi',
    services: {},
    variables: {},
    defaults: {
      scope: {
        clientVersion: 'x-client-version',
        sessionId: 'x-session-id'
      }
    },
    routes: [
      {
        path: 'GET /scope',
        scope: {
          sessionId: 'x-posthog-session-id'
        },
        authorizer,
        handler: {
          ...probeHandler,
          response: {
            status: 204
          }
        }
      }
    ]
  } as unknown as HttpService;
};

const wsService = {
  name: 'scopeWs',
  services: {},
  variables: {},
  schema: {
    type: 'object',
    properties: {}
  },
  defaults: {
    scope: {
      clientVersion: 'x-client-version',
      sessionId: 'x-posthog-session-id'
    }
  },
  connect: {
    handler: probeHandler,
    authorizer: probeHandler
  },
  disconnect: {
    handler: probeHandler
  },
  message: {
    handler: probeHandler
  }
} as unknown as WsService;

const getWsEvent = (live: boolean): EmulatorConnectionEvent => ({
  connection: {
    id: 'connection-1',
    live,
    write: () => {},
    close: () => {}
  },
  headers: {
    'x-client-version': '2.0.0'
  },
  query: {
    'x-trace-id': 'trace-ws',
    'x-posthog-session-id': 'session-ws'
  }
});

describe('local gateway scope', () => {
  afterEach(() => {
    globalThis.observeScope = undefined;
    Runtime.clearScope();
  });

  it('assert :: http request captures trace id and merged scope', async () => {
    const api = registerHttpLocalService(getHttpService(), options, context);
    const observed = observeScopes(1);

    const response = (await api.requestHandler({
      method: 'GET',
      path: '/scope',
      query: {},
      headers: {
        'x-trace-id': 'trace-http',
        'x-client-version': '1.2.3',
        'x-session-id': 'overridden-by-route',
        'x-posthog-session-id': 'session-1',
        'x-undeclared': 'ignored'
      }
    })) as { status: number };

    equal(response.status, 204);

    deepEqual(await observed, [
      {
        scope: {
          traceId: 'trace-http',
          clientVersion: '1.2.3',
          sessionId: 'session-1'
        },
        headers: {
          clientVersion: 'x-client-version',
          sessionId: 'x-posthog-session-id'
        }
      }
    ]);
  });

  it('assert :: http request without scope headers keeps a fresh trace id', async () => {
    const api = registerHttpLocalService(getHttpService(), options, context);
    const observed = observeScopes(1);

    await api.requestHandler({
      method: 'GET',
      path: '/scope',
      query: {},
      headers: {}
    });

    const [{ scope }] = await observed;

    match(scope?.traceId ?? '', UUID_PATTERN);
    deepEqual(Object.keys(scope ?? {}), ['traceId']);
  });

  it('assert :: http authorizer and request capture the same scope', async () => {
    const api = registerHttpLocalService(getHttpService(probeHandler), options, context);
    const observed = observeScopes(2);

    await api.requestHandler({
      method: 'GET',
      path: '/scope',
      query: {},
      headers: {
        'x-trace-id': 'trace-auth',
        'x-client-version': '1.2.3'
      }
    });

    const expected = {
      scope: {
        traceId: 'trace-auth',
        clientVersion: '1.2.3'
      },
      headers: {
        clientVersion: 'x-client-version',
        sessionId: 'x-posthog-session-id'
      }
    };

    deepEqual(await observed, [expected, expected]);
  });

  it('assert :: ws connect and authorizer read headers, then the query string', async () => {
    const ws = registerWsLocalService(wsService, options, context);
    const observed = observeScopes(2);

    await ws.connectHandler(getWsEvent(true));

    const expected = {
      scope: {
        traceId: 'trace-ws',
        clientVersion: '2.0.0',
        sessionId: 'session-ws'
      },
      headers: {
        clientVersion: 'x-client-version',
        sessionId: 'x-posthog-session-id'
      }
    };

    deepEqual(await observed, [expected, expected]);
  });

  it('assert :: ws disconnect keeps a fresh trace id without scope', async () => {
    const ws = registerWsLocalService(wsService, options, context);
    const observed = observeScopes(1);

    await ws.disconnectHandler(getWsEvent(false));

    const [{ scope, headers }] = await observed;

    notEqual(scope?.traceId, 'trace-ws');
    deepEqual(Object.keys(scope ?? {}), ['traceId']);
    deepEqual(headers, {});
  });

  it('assert :: http client forwards trace id and scope headers', async (t) => {
    const sent = new Promise<RequestInit | undefined>((resolve) => {
      t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
        resolve(init);
        return new Response(null, { status: 204 });
      });
    });

    const client = createHttpServiceClient('scopeApi', {
      ...options,
      operations: {
        probe: {
          method: 'GET',
          path: '/probe'
        }
      }
    }) as unknown as { probe: (request: HttpClientRequest) => Promise<unknown> };

    Runtime.setScope({ traceId: 'trace-out', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version' });

    await client.probe({});

    const headers = (await sent)?.headers as Record<string, string>;

    equal(headers['X-Trace-Id'], 'trace-out');
    equal(headers['x-client-version'], '1.2.3');
  });
});
