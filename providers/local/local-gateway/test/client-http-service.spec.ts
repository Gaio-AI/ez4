import type { ClientOperation } from '@ez4/gateway/library';
import type { HttpClientRequest } from '@ez4/gateway';
import type { ServerAnswer } from './common/server';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sendClientRequest } from '@ez4/gateway/utils';
import { getServiceName } from '@ez4/project/library';
import { NamingStyle, SchemaType } from '@ez4/schema';
import { HttpError } from '@ez4/gateway';
import { Runtime } from '@ez4/common';

import { createHttpServiceClient } from '../src/client/http/service';
import { serveOptions } from './common/emulator';
import { startServer } from './common/server';

type TestClient = Record<string, (request: HttpClientRequest) => Promise<unknown>>;

type ParityCase = {
  operation: ClientOperation;
  request: HttpClientRequest;
  answer: ServerAnswer;
};

const TRACE_ID = 'trace-parity';

const authorization = {
  header: 'authorization',
  value: 'Bearer secret'
};

const itemSchema = {
  type: SchemaType.Object,
  properties: {
    itemId: {
      type: SchemaType.String
    },
    itemName: {
      type: SchemaType.String
    }
  }
} as const;

const parityCases: Record<string, ParityCase> = {
  getItem: {
    operation: {
      method: 'GET',
      path: '/items/{itemId}',
      namingStyle: NamingStyle.SnakeCase,
      querySchema: {
        type: SchemaType.Object,
        properties: {
          pageSize: {
            type: SchemaType.Number
          }
        }
      },
      responseSchema: itemSchema
    },
    request: {
      parameters: { itemId: 'item-1' },
      query: { pageSize: 10 },
      headers: { 'x-custom': 'custom' }
    },
    answer: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"item_id":"item-1","item_name":"First"}'
    }
  },
  createItem: {
    operation: {
      method: 'POST',
      path: '/items',
      namingStyle: NamingStyle.SnakeCase,
      bodySchema: itemSchema
    },
    request: {
      body: { itemId: 'item-2', itemName: 'Second' }
    },
    answer: {
      status: 201
    }
  },
  sendText: {
    operation: {
      method: 'PUT',
      path: '/text'
    },
    request: {
      body: 'plain text'
    },
    answer: {
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'stored'
    }
  },
  getSecret: {
    operation: {
      method: 'GET',
      path: '/secret',
      authorize: true
    },
    request: {},
    answer: {
      status: 204
    }
  },
  conflict: {
    operation: {
      method: 'POST',
      path: '/conflict'
    },
    request: {},
    answer: {
      status: 409,
      headers: { 'content-type': 'application/json' },
      body: '{"type":"error","message":"Item exists.","context":{"itemId":"item-1"}}'
    }
  },
  broken: {
    operation: {
      method: 'GET',
      path: '/broken'
    },
    request: {},
    answer: {
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: '{"message":"Internal Server Error"}'
    }
  }
};

const getOutcome = async (callback: () => Promise<unknown>) => {
  try {
    return {
      result: await callback()
    };
  } catch (error) {
    if (error instanceof HttpError) {
      return {
        error: {
          type: error.constructor.name,
          status: error.status,
          message: error.message,
          context: error.context
        }
      };
    }

    return {
      error
    };
  }
};

const withTraceScope = <T>(callback: () => Promise<T>) => {
  return Runtime.runWithScope(() => {
    Runtime.setScope({ traceId: TRACE_ID });

    return callback();
  });
};

describe('local http client', () => {
  const getClient = (serviceHost: string, operations: Record<string, ClientOperation>) => {
    return createHttpServiceClient('parityApi', {
      ...serveOptions,
      authorization,
      serviceHost,
      operations
    }) as unknown as TestClient;
  };

  it('assert :: emulator requests skip a stubbed fetch', async (t) => {
    const server = await startServer(() => ({ status: 204 }));

    const stub = t.mock.method(globalThis, 'fetch', async () => {
      return new Response(null, { status: 204 });
    });

    try {
      const client = getClient(server.host, {
        probe: {
          method: 'GET',
          path: '/probe'
        }
      });

      await client.probe({});

      equal(stub.mock.callCount(), 0);
      equal(server.received.length, 1);
      //
    } finally {
      await server.close();
    }
  });

  it('assert :: send and receive as the gateway client', async () => {
    const gatewayPath = `/${getServiceName('parityApi', serveOptions)}`;

    const server = await startServer((request) => {
      const [path] = (request.url ?? '').split('?');

      const parityCase = Object.values(parityCases).find(({ operation }) => {
        const [, segment] = operation.path.split('/');

        return operation.method === request.method && path.startsWith(`${gatewayPath}/${segment}`);
      });

      return parityCase?.answer ?? { status: 404 };
    });

    try {
      const client = getClient(
        server.host,
        Object.fromEntries(Object.entries(parityCases).map(([name, { operation }]) => [name, operation]))
      );

      for (const [index, name] of Object.keys(parityCases).entries()) {
        const { operation, request } = parityCases[name];

        const localOutcome = await withTraceScope(() => getOutcome(() => client[name](request)));

        equal(server.received.length, index * 2 + 1, `${name} sent`);

        // The same URL the local client built, since building it isn't what differs.
        const url = `http://${server.host}${server.received.at(-1)?.url}`;

        const sharedOutcome = await getOutcome(() =>
          sendClientRequest(url, operation.method, {
            ...request,
            bodySchema: operation.bodySchema,
            responseSchema: operation.responseSchema,
            namingStyle: operation.namingStyle,
            headers: {
              ['X-Trace-Id']: TRACE_ID,
              ...request.headers
            },
            ...(operation.authorize && {
              authorization
            })
          })
        );

        equal(server.received.length, index * 2 + 2, `${name} sent`);

        const [localRequest, sharedRequest] = server.received.slice(-2);

        deepEqual(localRequest, sharedRequest, `${name} request`);
        deepEqual(localOutcome, sharedOutcome, `${name} outcome`);
      }
      //
    } finally {
      await server.close();
    }
  });
});
