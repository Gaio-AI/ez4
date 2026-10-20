import type { EmulatorResponse } from '@ez4/project/library';
import type { HttpService } from '@ez4/gateway/library';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { registerHttpLocalService } from '../src/provider/http/local';
import { emulateContext, getHandler, getRequest, serveOptions } from './common/emulator';

const getRoute = (path: string, allow: string[]) => {
  return {
    path,
    allow,
    handler: {
      ...getHandler('guard-probe.ts', 'listItems'),
      request: {
        headers: {
          type: 'object',
          properties: {
            'x-role': {
              type: 'string'
            }
          }
        }
      },
      response: {
        status: 204
      }
    }
  };
};

const guardedService = {
  name: 'guardedApi',
  services: {},
  variables: {},
  defaults: {
    guard: getHandler('guard-probe.ts', 'roleGuard')
  },
  routes: [getRoute('GET /items', ['reader', 'writer']), getRoute('POST /items', ['writer'])]
} as unknown as HttpService;

describe('local gateway route guard', () => {
  const api = registerHttpLocalService(guardedService, serveOptions, emulateContext);

  const sendRequest = async (method: string, role: string) => {
    return (await api.requestHandler(getRequest(method, '/items', { 'x-trace-id': 'trace-guard', 'x-role': role }))) as EmulatorResponse;
  };

  it('assert :: the guard lets an allowed request reach the handler', async () => {
    const response = await sendRequest('GET', 'reader');

    equal(response.status, 204);
    equal(response.headers?.['x-role'], 'reader');
  });

  it('assert :: the guard refuses the request with its own error', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    const response = await sendRequest('POST', 'reader');

    equal(response.status, 403);

    deepEqual(JSON.parse(response.body as string), {
      type: 'error',
      message: 'Role reader is not allowed.'
    });
  });

  it('assert :: each route gives the guard its own allow', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    equal((await sendRequest('GET', 'writer')).status, 204);
    equal((await sendRequest('POST', 'writer')).status, 204);
    equal((await sendRequest('GET', 'guest')).status, 403);
  });
});
