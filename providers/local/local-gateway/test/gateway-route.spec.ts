import type { EmulatorResponse } from '@ez4/project/library';
import type { HttpService } from '@ez4/gateway/library';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerHttpLocalService } from '../src/provider/http/local';
import { emulateContext, getHandler, getRequest, serveOptions } from './common/emulator';

const getRoute = (path: string, name: string, parameters?: string[]) => {
  return {
    path,
    handler: {
      ...getHandler('route-probe.ts', name),
      ...(parameters && {
        request: {
          parameters: {
            type: 'object',
            properties: Object.fromEntries(parameters.map((parameter) => [parameter, { type: 'string' }]))
          }
        }
      }),
      response: {
        status: 204
      }
    }
  };
};

// Declared from the least specific, so the first pattern that matches is never the one API Gateway picks.
const routeService = {
  name: 'routeApi',
  services: {},
  variables: {},
  routes: [
    getRoute('ANY /{proxy+}', 'anyProxyRoute', ['proxy']),
    getRoute('GET /pets/{proxy+}', 'petsProxyRoute', ['proxy']),
    getRoute('GET /pets/dog/{id}', 'dogRoute', ['id']),
    getRoute('GET /pets/dog/1', 'firstDogRoute'),
    getRoute('ANY /items/{itemId}', 'anyItemRoute', ['itemId']),
    getRoute('GET /items/{id}', 'getItemRoute', ['id'])
  ]
} as unknown as HttpService;

describe('local gateway routes', () => {
  const api = registerHttpLocalService(routeService, serveOptions, emulateContext);

  const assertRoute = async (method: string, path: string, route: string, parameters: Record<string, string>) => {
    const response = (await api.requestHandler(getRequest(method, path))) as EmulatorResponse;

    equal(response.status, 204);

    deepEqual(
      {
        route: response.headers?.['x-route'],
        parameters: JSON.parse(response.headers?.['x-parameters'] ?? '{}')
      },
      {
        route,
        parameters
      }
    );
  };

  it('assert :: a literal segment wins over a path parameter', async () => {
    await assertRoute('GET', '/pets/dog/1', 'GET /pets/dog/1', {});
  });

  it('assert :: a path parameter wins over a greedy one', async () => {
    await assertRoute('GET', '/pets/dog/2', 'GET /pets/dog/{id}', { id: '2' });
  });

  it('assert :: a greedy parameter takes the rest of the path', async () => {
    await assertRoute('GET', '/pets/cat/1', 'GET /pets/{proxy+}', { proxy: 'cat/1' });
    await assertRoute('GET', '/pets/cat/1/toys/2', 'GET /pets/{proxy+}', { proxy: 'cat/1/toys/2' });
  });

  it('assert :: a greedy parameter needs one segment at least', async () => {
    await assertRoute('GET', '/pets', 'ANY /{proxy+}', { proxy: 'pets' });
  });

  it('assert :: any method catches the methods without a route', async () => {
    await assertRoute('POST', '/test/5', 'ANY /{proxy+}', { proxy: 'test/5' });
    await assertRoute('POST', '/items/7', 'ANY /items/{itemId}', { itemId: '7' });
  });

  it('assert :: a method route wins over an any route', async () => {
    await assertRoute('GET', '/items/7', 'GET /items/{id}', { id: '7' });
  });
});
