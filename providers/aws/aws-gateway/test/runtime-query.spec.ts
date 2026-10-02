import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { TestContext } from 'node:test';

import { deepEqual, equal } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Runtime } from '@ez4/common';

import { apiEntryPoint as requestEntryPoint } from '../lib/request';
import { apiEntryPoint as authorizerEntryPoint } from '../lib/authorizer';
import { lambdaContext, setEntryPointGlobals } from './common/entry-point';

type RequestEvent = Parameters<typeof requestEntryPoint>[0];
type AuthorizerEvent = Parameters<typeof authorizerEntryPoint>[0];

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

const strictPreferences = {
  namingStyle: 'snake',
  strictQueryStrings: true
};

const setQueryGlobals = (schema: object | null, preferences: object, received: { query?: unknown }) => {
  setEntryPointGlobals(undefined, (async (request: { query?: unknown }) => {
    received.query = request.query;
    return { status: 204 };
  }) as () => Promise<unknown>);

  Object.assign(globalThis, {
    __EZ4_QUERY_SCHEMA: schema,
    __EZ4_PREFERENCES: preferences
  });
};

const sendRequest = async (query?: Record<string, string>) => {
  const event = {
    headers: {
      'x-trace-id': 'trace-query'
    },
    queryStringParameters: query,
    isBase64Encoded: false,
    requestContext: {
      timeEpoch: 0,
      http: {
        method: 'GET',
        path: '/items'
      }
    }
  };

  return (await requestEntryPoint(event as unknown as RequestEvent, lambdaContext)) as APIGatewayProxyStructuredResultV2;
};

const assertRejected = async (t: TestContext, query: Record<string, string>, names: string[]) => {
  t.mock.method(console, 'warn', () => {});

  const response = await sendRequest(query);

  equal(response.statusCode, 400);

  deepEqual(JSON.parse(response.body!), {
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

describe('gateway runtime query strings', () => {
  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: strict route takes declared query strings', async () => {
    const received: { query?: unknown } = {};

    setQueryGlobals(querySchema, strictPreferences, received);

    equal((await sendRequest({ tag_id: 'a', tags: 'b,c' })).statusCode, 204);

    deepEqual(received.query, { tagId: 'a', tags: ['b', 'c'] });
  });

  it('assert :: strict route rejects an undeclared query string', async (t) => {
    setQueryGlobals(querySchema, strictPreferences, {});

    await assertRejected(t, { tag: 'a' }, ['$query.tag']);
  });

  it('assert :: strict route rejects a name out of its naming style', async (t) => {
    setQueryGlobals(querySchema, strictPreferences, {});

    await assertRejected(t, { tagId: 'a' }, ['$query.tagId']);
  });

  it('assert :: strict route without query rejects any query string', async (t) => {
    const received: { query?: unknown } = {};

    setQueryGlobals(null, strictPreferences, received);

    equal((await sendRequest()).statusCode, 204);
    equal(received.query, undefined);

    await assertRejected(t, { tag: 'a' }, ['$query.tag']);
  });

  it('assert :: route without strict drops an undeclared query string', async () => {
    const received: { query?: unknown } = {};

    setQueryGlobals(querySchema, { namingStyle: 'snake' }, received);

    equal((await sendRequest({ tag: 'a' })).statusCode, 204);

    deepEqual(received.query, {});
  });

  it('assert :: authorizer of a strict route takes the route query strings', async () => {
    setEntryPointGlobals(undefined, async () => ({ identity: { id: 'probe' } }));

    Object.assign(globalThis, {
      __EZ4_QUERY_SCHEMA: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string'
          }
        }
      },
      __EZ4_PREFERENCES: strictPreferences
    });

    const event = {
      headers: {},
      queryStringParameters: {
        api_key: 'key',
        tag_id: 'a'
      },
      routeArn: 'arn:aws:execute-api:us-east-1:000000000000:api/stage/GET/items',
      requestContext: {
        timeEpoch: 0,
        http: {
          method: 'GET',
          path: '/items'
        }
      }
    };

    const response = await authorizerEntryPoint(event as unknown as AuthorizerEvent, lambdaContext);

    equal(response.policyDocument.Statement[0].Effect, 'Allow');
  });
});
