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
import { startServer } from './common/server';

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

const concurrentHandler = {
  ...probeHandler,
  name: 'probeConcurrentScope'
};

const concurrentAuthorizer = {
  ...probeHandler,
  name: 'probeConcurrentAuthorizer'
};

const getConcurrentHttpService = (authorizer?: typeof probeHandler) => {
  return {
    name: 'concurrentApi',
    services: {},
    variables: {},
    defaults: {
      scope: {
        clientVersion: 'x-client-version'
      }
    },
    routes: [
      {
        path: 'GET /concurrent',
        authorizer,
        handler: {
          ...concurrentHandler,
          response: {
            status: 204
          }
        }
      }
    ]
  } as unknown as HttpService;
};

const concurrentWsService = {
  name: 'concurrentWs',
  services: {},
  variables: {},
  schema: {
    type: 'object',
    properties: {}
  },
  defaults: {
    scope: {
      clientVersion: 'x-client-version'
    }
  },
  connect: {
    handler: concurrentHandler,
    authorizer: concurrentAuthorizer
  },
  disconnect: {
    handler: concurrentHandler
  },
  message: {
    handler: concurrentHandler
  }
} as unknown as WsService;

// Each gate opens once `count` invocations reach it, so all of them set their scope before any reads it.
const setScopeGates = (count: number) => {
  const gates: Record<string, () => Promise<void>> = {};

  globalThis.scopeGate = (name) => {
    if (!gates[name]) {
      let arrived = 0;
      let open = () => {};

      const opened = new Promise<void>((resolve) => {
        open = resolve;
      });

      gates[name] = () => {
        if (++arrived === count) {
          open();
        }

        return opened;
      };
    }

    return gates[name]();
  };
};

const getSeenScopes = (observed: ObservedScope[]) => {
  return observed.map(({ traceId, scope }) => [traceId, scope?.traceId, scope?.clientVersion]).sort();
};

describe('local gateway scope', () => {
  afterEach(() => {
    globalThis.observeScope = undefined;
    globalThis.scopeGate = undefined;
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

  it('assert :: http client forwards trace id and scope headers', async () => {
    const server = await startServer(() => ({ status: 204 }));

    try {
      const client = createHttpServiceClient('scopeApi', {
        ...options,
        serviceHost: server.host,
        operations: {
          probe: {
            method: 'GET',
            path: '/probe'
          }
        }
      }) as unknown as { probe: (request: HttpClientRequest) => Promise<unknown> };

      Runtime.setScope({ traceId: 'trace-out', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version' });

      await client.probe({});

      const [{ headers }] = server.received;

      equal(headers['x-trace-id'], 'trace-out');
      equal(headers['x-client-version'], '1.2.3');
      //
    } finally {
      await server.close();
    }
  });

  it('assert :: concurrent http requests keep their own scope', async () => {
    const api = registerHttpLocalService(getConcurrentHttpService(), options, context);
    const observed = observeScopes(2);

    setScopeGates(2);

    await Promise.all(
      ['trace-a', 'trace-b'].map((traceId) => {
        return api.requestHandler({
          method: 'GET',
          path: '/concurrent',
          query: {},
          headers: {
            'x-trace-id': traceId,
            'x-client-version': `version-${traceId}`
          }
        });
      })
    );

    deepEqual(getSeenScopes(await observed), [
      ['trace-a', 'trace-a', 'version-trace-a'],
      ['trace-b', 'trace-b', 'version-trace-b']
    ]);
  });

  it('assert :: concurrent http authorizers keep their own scope', async () => {
    const api = registerHttpLocalService(getConcurrentHttpService(concurrentAuthorizer), options, context);
    const observed = observeScopes(4);

    setScopeGates(2);

    await Promise.all(
      ['trace-a', 'trace-b'].map((traceId) => {
        return api.requestHandler({
          method: 'GET',
          path: '/concurrent',
          query: {},
          headers: {
            'x-trace-id': traceId,
            'x-client-version': `version-${traceId}`
          }
        });
      })
    );

    deepEqual(getSeenScopes(await observed), [
      ['trace-a', 'trace-a', 'version-trace-a'],
      ['trace-a', 'trace-a', 'version-trace-a'],
      ['trace-b', 'trace-b', 'version-trace-b'],
      ['trace-b', 'trace-b', 'version-trace-b']
    ]);
  });

  it('assert :: concurrent ws connections keep their own scope', async () => {
    const ws = registerWsLocalService(concurrentWsService, options, context);
    const observed = observeScopes(4);

    setScopeGates(2);

    await Promise.all(
      ['trace-a', 'trace-b'].map((traceId) => {
        return ws.connectHandler({
          connection: {
            id: `connection-${traceId}`,
            live: true,
            write: () => {},
            close: () => {}
          },
          headers: {
            'x-client-version': `version-${traceId}`
          },
          query: {
            'x-trace-id': traceId
          }
        });
      })
    );

    deepEqual(getSeenScopes(await observed), [
      ['trace-a', 'trace-a', 'version-trace-a'],
      ['trace-a', 'trace-a', 'version-trace-a'],
      ['trace-b', 'trace-b', 'version-trace-b'],
      ['trace-b', 'trace-b', 'version-trace-b']
    ]);
  });

  it('assert :: concurrent ws messages keep their own scope', async () => {
    const ws = registerWsLocalService(concurrentWsService, options, context);
    const observed = observeScopes(2);

    setScopeGates(2);

    await Promise.all(
      ['connection-a', 'connection-b'].map((connectionId) => {
        return ws.messageHandler({
          connection: {
            id: connectionId,
            live: true,
            write: () => {},
            close: () => {}
          },
          body: Buffer.from('{}')
        });
      })
    );

    const [first, second] = await observed;

    notEqual(first.traceId, second.traceId);

    equal(first.scope?.traceId, first.traceId);
    equal(second.scope?.traceId, second.traceId);
  });
});
