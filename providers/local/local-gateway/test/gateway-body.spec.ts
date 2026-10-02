import type { EmulatorConnection, EmulatorResponse } from '@ez4/project/library';
import type { HttpService, WsService } from '@ez4/gateway/library';
import type { TestContext } from 'node:test';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { registerHttpLocalService } from '../src/provider/http/local';
import { registerWsLocalService } from '../src/provider/ws/local';
import { emulateContext, getHandler, getRequest, serveOptions } from './common/emulator';

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

const bodyService = {
  name: 'bodyApi',
  services: {},
  variables: {},
  routes: [
    {
      path: 'POST /items',
      handler: {
        ...getHandler('body-probe.ts', 'receiveBody'),
        request: {
          body: bodySchema
        },
        response: {
          status: 204
        }
      }
    }
  ]
} as unknown as HttpService;

const messageService = {
  name: 'bodyWs',
  services: {},
  variables: {},
  schema: bodySchema,
  connect: {
    handler: getHandler('body-probe.ts', 'receiveMessage')
  },
  disconnect: {
    handler: getHandler('body-probe.ts', 'receiveMessage')
  },
  message: {
    handler: {
      ...getHandler('body-probe.ts', 'receiveMessage'),
      request: {
        body: bodySchema
      }
    }
  }
} as unknown as WsService;

const connection: EmulatorConnection = {
  id: 'connection-1',
  live: true,
  write: () => {},
  close: () => {}
};

const captureLogs = (t: TestContext) => {
  const lines: string[] = [];

  for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    t.mock.method(Logger, level, (message: string) => {
      lines.push(message);
    });
  }

  return lines;
};

describe('local gateway body', () => {
  const api = registerHttpLocalService(bodyService, serveOptions, emulateContext);
  const ws = registerWsLocalService(messageService, serveOptions, emulateContext);

  const sendRequest = async (body: string) => {
    const request = {
      ...getRequest('POST', '/items', { 'x-trace-id': 'trace-body' }),
      body: Buffer.from(body)
    };

    return (await api.requestHandler(request)) as EmulatorResponse;
  };

  it('assert :: request with json body reaches the handler', async () => {
    const response = await sendRequest('{"email": "jane@example.com"}');

    equal(response.status, 204);
    equal(response.headers?.['x-body'], '{"email":"jane@example.com"}');
  });

  it('assert :: request with malformed json answers bad request', async (t) => {
    const logs = captureLogs(t);

    const response = await sendRequest(malformedBody);

    equal(response.status, 400);
    equal(response.headers?.['x-trace-id'], 'trace-body');

    deepEqual(JSON.parse(response.body!.toString()), malformedError);

    ok(!logs.some((line) => line.includes('jane@example.com')));
  });

  it('assert :: message with malformed json answers bad request', async (t) => {
    const logs = captureLogs(t);

    const response = await ws.messageHandler({
      connection,
      body: Buffer.from(malformedBody)
    });

    deepEqual(JSON.parse(response!), malformedError);

    ok(!logs.some((line) => line.includes('jane@example.com')));
  });
});
