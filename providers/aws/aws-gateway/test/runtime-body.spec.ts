import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { TestContext } from 'node:test';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { inspect } from 'node:util';

import { Runtime } from '@ez4/common';

import { apiEntryPoint as requestEntryPoint } from '../lib/request';
import { apiEntryPoint as messageEntryPoint } from '../lib/message';
import { lambdaContext, setEntryPointGlobals } from './common/entry-point';

type RequestEvent = Parameters<typeof requestEntryPoint>[0];
type MessageEvent = Parameters<typeof messageEntryPoint>[0];

const bodySchema = {
  type: 'object',
  properties: {
    email: {
      type: 'string'
    }
  }
};

// A client value that must not reach the logs.
const malformedBody = '{"email": "jane@example.com",';

const malformedError = {
  type: 'error',
  message: 'Malformed body payload.',
  context: {
    details: [
      {
        code: 'SyntaxError',
        message: 'Valid JSON for [$body] is expected.',
        path: '$body'
      }
    ]
  }
};

const setBodyGlobals = (handle: (request: { body?: unknown }) => Promise<unknown>) => {
  setEntryPointGlobals(undefined, handle as () => Promise<unknown>);

  Object.assign(globalThis, {
    __EZ4_BODY_SCHEMA: bodySchema
  });
};

const captureLogs = (t: TestContext) => {
  const lines: string[] = [];

  for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    t.mock.method(console, level, (...values: unknown[]) => {
      lines.push(inspect(values, { depth: null }));
    });
  }

  return lines;
};

const sendRequest = async (body: string) => {
  const event = {
    headers: {
      'x-trace-id': 'trace-body'
    },
    body,
    isBase64Encoded: false,
    requestContext: {
      timeEpoch: 0,
      http: {
        method: 'POST',
        path: '/items'
      }
    }
  };

  return (await requestEntryPoint(event as unknown as RequestEvent, lambdaContext)) as APIGatewayProxyStructuredResultV2;
};

const sendMessage = async (body: string) => {
  const event = {
    body,
    requestContext: {
      requestTimeEpoch: 0,
      connectionId: 'connection-1'
    }
  };

  return (await messageEntryPoint(event as unknown as MessageEvent, lambdaContext)) as APIGatewayProxyStructuredResultV2;
};

describe('gateway runtime body', () => {
  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: request with json body reaches the handler', async () => {
    let received: unknown;

    setBodyGlobals(async ({ body }) => {
      received = body;
      return { status: 204 };
    });

    const response = await sendRequest('{"email": "jane@example.com"}');

    equal(response.statusCode, 204);

    deepEqual(received, { email: 'jane@example.com' });
  });

  it('assert :: request with malformed json answers bad request', async (t) => {
    const logs = captureLogs(t);

    setBodyGlobals(async () => ({ status: 204 }));

    const response = await sendRequest(malformedBody);

    equal(response.statusCode, 400);
    equal(response.headers?.['x-trace-id'], 'trace-body');

    deepEqual(JSON.parse(response.body!), malformedError);

    ok(logs.length > 0);
    ok(!logs.some((line) => line.includes('jane@example.com')));
  });

  it('assert :: message with malformed json answers bad request', async (t) => {
    const logs = captureLogs(t);

    setBodyGlobals(async () => undefined);

    const response = await sendMessage(malformedBody);

    equal(response.statusCode, 400);

    deepEqual(JSON.parse(response.body!), malformedError);

    ok(logs.length > 0);
    ok(!logs.some((line) => line.includes('jane@example.com')));
  });
});
