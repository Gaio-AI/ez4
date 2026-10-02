import type { EmulatorResponse } from '@ez4/project/library';
import type { HttpService } from '@ez4/gateway/library';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { registerHttpLocalService } from '../src/provider/http/local';
import { emulateContext, getHandler, serveOptions } from './common/emulator';

const querySchema = {
  type: 'object',
  properties: {
    tagId: {
      type: 'string',
      optional: true
    },
    tags: {
      type: 'array',
      optional: true,
      element: {
        type: 'string'
      }
    }
  }
};

const getRoute = (path: string, request?: object, preferences?: object, authorizer?: object) => {
  return {
    path,
    preferences,
    authorizer,
    handler: {
      ...getHandler('query-probe.ts', 'receiveQuery'),
      request,
      response: {
        status: 204
      }
    }
  };
};

// The defaults turn strict on, and a route that declares preferences of its own keeps it, as the deploy merges both.
const queryService = {
  name: 'queryApi',
  services: {},
  variables: {},
  defaults: {
    preferences: {
      strictQueryStrings: true
    }
  },
  routes: [
    getRoute('GET /strict', { query: querySchema }, { namingStyle: 'snake' }),
    getRoute('GET /strict-without-query', undefined, { namingStyle: 'snake' }),
    getRoute('GET /loose', { query: querySchema }, { namingStyle: 'snake', strictQueryStrings: false }),
    getRoute(
      'GET /authorized',
      {
        query: {
          type: 'object',
          properties: {
            tagId: {
              type: 'string'
            },
            apiKey: {
              type: 'string'
            }
          }
        }
      },
      { namingStyle: 'snake' },
      {
        ...getHandler('query-probe.ts', 'authorizeQuery'),
        request: {
          query: {
            type: 'object',
            properties: {
              apiKey: {
                type: 'string'
              }
            }
          }
        }
      }
    )
  ]
} as unknown as HttpService;

describe('local gateway query strings', () => {
  const api = registerHttpLocalService(queryService, serveOptions, emulateContext);

  const sendRequest = async (path: string, query: Record<string, string>) => {
    const request = {
      method: 'GET',
      path,
      headers: {
        'x-trace-id': 'trace-query'
      },
      query
    };

    return (await api.requestHandler(request)) as EmulatorResponse;
  };

  const assertRejected = async (path: string, query: Record<string, string>, names: string[]) => {
    const response = await sendRequest(path, query);

    equal(response.status, 400);

    deepEqual(JSON.parse(response.body!.toString()), {
      type: 'error',
      message: 'Malformed query strings.',
      context: {
        details: [
          {
            code: 'UnexpectedPropertiesError',
            message: `Property [${names[0]}] is not expected.`,
            path: '$query',
            properties: names,
            input: query
          }
        ]
      }
    });
  };

  it('assert :: strict route takes declared query strings', async () => {
    const response = await sendRequest('/strict', { tag_id: 'a', tags: 'b,c' });

    equal(response.status, 204);
    equal(response.headers?.['x-query'], JSON.stringify({ tagId: 'a', tags: ['b', 'c'] }));
  });

  it('assert :: strict route rejects an undeclared query string', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    await assertRejected('/strict', { tag: 'a' }, ['$query.tag']);
  });

  it('assert :: strict route rejects a name out of its naming style', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    await assertRejected('/strict', { tagId: 'a' }, ['$query.tagId']);
  });

  it('assert :: strict route without query rejects any query string', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    equal((await sendRequest('/strict-without-query', {})).status, 204);

    await assertRejected('/strict-without-query', { tag: 'a' }, ['$query.tag']);
  });

  it('assert :: route without strict drops an undeclared query string', async () => {
    const response = await sendRequest('/loose', { tag: 'a' });

    equal(response.status, 204);
    equal(response.headers?.['x-query'], JSON.stringify({}));
  });

  it('assert :: authorizer of a strict route takes the route query strings', async () => {
    const response = await sendRequest('/authorized', { tag_id: 'a', api_key: 'key' });

    equal(response.status, 204);
    equal(response.headers?.['x-query'], JSON.stringify({ tagId: 'a', apiKey: 'key' }));
  });
});
