import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { TestContext } from 'node:test';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Runtime } from '@ez4/common';

import { apiEntryPoint as groupEntryPoint } from '../lib/group';
import { lambdaContext } from './common/entry-point';

type RequestEvent = Parameters<typeof groupEntryPoint>[0];

type Received = {
  request?: Record<string, unknown>;
  scope?: Runtime.Scope;
};

class ItemConflictError extends Error {}

// Body of the POST route, which reads snake case.
const itemBody = JSON.stringify({ item_name: 'new item' });

const itemResponseSchema = {
  type: 'object',
  properties: {
    itemName: {
      type: 'string'
    }
  }
};

// Each route has its own schemas, errors, preferences and scope.
const getRoutes = () => ({
  'GET /items/{itemId}': {
    handler: 0,
    config: JSON.stringify({
      parametersSchema: {
        type: 'object',
        properties: {
          itemId: {
            type: 'string'
          }
        }
      },
      responseSchema: itemResponseSchema,
      errorsMap: {
        ItemConflictError: 409
      },
      preferences: {
        strictQueryStrings: true
      },
      scope: {
        clientVersion: 'x-client-version'
      }
    })
  },
  'POST /items': {
    handler: 1,
    config: JSON.stringify({
      bodySchema: {
        type: 'object',
        properties: {
          itemName: {
            type: 'string'
          }
        }
      },
      responseSchema: itemResponseSchema,
      preferences: {
        namingStyle: 'snake'
      }
    })
  }
});

const setGroupGlobals = (received: Received, error?: Error) => {
  const listenerEvents: string[] = [];

  const handle = async (request: Record<string, unknown>) => {
    received.request = request;
    received.scope = Runtime.getScope();

    if (error) {
      throw error;
    }

    return {
      status: 200,
      body: {
        itemName: 'first item'
      }
    };
  };

  Object.assign(globalThis, {
    __EZ4_ROUTES: getRoutes(),
    __EZ4_HANDLERS: [handle, handle],
    __EZ4_CONTEXT: {},
    dispatch: async (event: { type: string; request: { routeKey?: string } }) => {
      listenerEvents.push(`${event.type} ${event.request.routeKey}`);
    }
  });

  return listenerEvents;
};

const sendRequest = async (routeKey: string, path: string, options: { body?: string; query?: Record<string, string> } = {}) => {
  const [method] = routeKey.split(' ');

  const event = {
    routeKey,
    headers: {
      'x-trace-id': 'trace-group',
      'x-client-version': '1.2.3'
    },
    pathParameters: path.startsWith('/items/') ? { itemId: path.split('/')[2] } : undefined,
    queryStringParameters: options.query,
    body: options.body,
    isBase64Encoded: false,
    requestContext: {
      timeEpoch: 0,
      http: {
        method,
        path
      }
    }
  };

  return (await groupEntryPoint(event as unknown as RequestEvent, lambdaContext)) as APIGatewayProxyStructuredResultV2;
};

const muteLogs = (t: TestContext) => {
  const errors: unknown[] = [];

  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', (entry: unknown) => errors.push(entry));

  return errors;
};

describe('gateway runtime group', () => {
  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: each route validates with its own schemas', async () => {
    const received: Received = {};

    const listenerEvents = setGroupGlobals(received);

    const getResponse = await sendRequest('GET /items/{itemId}', '/items/item-1');

    equal(getResponse.statusCode, 200);
    deepEqual(received.request?.parameters, { itemId: 'item-1' });
    equal(received.request?.body, undefined);
    equal(received.request?.routeKey, 'GET /items/{itemId}');

    const postResponse = await sendRequest('POST /items', '/items', { body: itemBody });

    equal(postResponse.statusCode, 200);
    deepEqual(received.request?.body, { itemName: 'new item' });
    equal(received.request?.parameters, undefined);
    equal(received.request?.routeKey, 'POST /items');

    // The listener sees the route as well.
    ok(listenerEvents.includes('begin GET /items/{itemId}'));
    ok(listenerEvents.includes('end POST /items'));
  });

  it('assert :: each route answers with its own preferences', async (t) => {
    muteLogs(t);

    setGroupGlobals({});

    const getResponse = await sendRequest('GET /items/{itemId}', '/items/item-1');
    const postResponse = await sendRequest('POST /items', '/items', { body: itemBody });

    deepEqual(JSON.parse(getResponse.body!), { itemName: 'first item' });
    deepEqual(JSON.parse(postResponse.body!), { item_name: 'first item' });

    // Only the GET route rejects a query string it doesn't declare.
    const strictResponse = await sendRequest('GET /items/{itemId}', '/items/item-1', { query: { unknown: 'value' } });
    const looseResponse = await sendRequest('POST /items', '/items', { body: itemBody, query: { unknown: 'value' } });

    equal(strictResponse.statusCode, 400);
    equal(looseResponse.statusCode, 200);
  });

  it('assert :: each route maps errors with its own map', async (t) => {
    muteLogs(t);

    setGroupGlobals({}, new ItemConflictError('Item exists.'));

    const getResponse = await sendRequest('GET /items/{itemId}', '/items/item-1');
    const postResponse = await sendRequest('POST /items', '/items', { body: itemBody });

    equal(getResponse.statusCode, 409);
    equal(postResponse.statusCode, 500);
  });

  it('assert :: each route reads its own scope', async () => {
    const received: Received = {};

    setGroupGlobals(received);

    await sendRequest('GET /items/{itemId}', '/items/item-1');

    deepEqual(received.scope, { clientVersion: '1.2.3', traceId: 'trace-group' });

    await sendRequest('POST /items', '/items', { body: itemBody });

    deepEqual(received.scope, { traceId: 'trace-group' });
  });

  it('assert :: route settings are parsed on the route first request', async (t) => {
    setGroupGlobals({});

    const routes = getRoutes();

    Object.assign(globalThis, { __EZ4_ROUTES: routes });

    const parse = t.mock.method(JSON, 'parse');

    const getConfig = routes['GET /items/{itemId}'].config;
    const postConfig = routes['POST /items'].config;

    await sendRequest('GET /items/{itemId}', '/items/item-1');
    await sendRequest('GET /items/{itemId}', '/items/item-2');

    const parsedConfigs = parse.mock.calls.map(({ arguments: [text] }) => text);

    equal(parsedConfigs.filter((text) => text === getConfig).length, 1);
    equal(parsedConfigs.filter((text) => text === postConfig).length, 0);
  });

  it('assert :: unknown route answers not found and logs an error', async (t) => {
    const errors = muteLogs(t);

    const received: Received = {};

    const listenerEvents = setGroupGlobals(received);

    for (const routeKey of ['DELETE /items/{itemId}', 'constructor']) {
      const response = await sendRequest(routeKey, '/items/item-1');

      equal(response.statusCode, 404);
      equal(response.headers?.['x-trace-id'], 'trace-group');
    }

    equal(received.request, undefined);
    deepEqual(listenerEvents, []);

    equal(errors.length, 2);
    deepEqual(errors[0], { traceId: 'trace-group', routeKey: 'DELETE /items/{itemId}', error: 'Route not served by this group.' });
  });
});
