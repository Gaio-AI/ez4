import type { EmulatorResponse } from '@ez4/project/library';
import type { HttpCors, HttpService } from '@ez4/gateway/library';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerHttpLocalService } from '../src/provider/http/local';
import { emulateContext, getHandler, getRequest, serveOptions } from './common/emulator';

const ORIGIN = 'https://app.test';

const getCorsService = (cors?: HttpCors) => {
  const handler = {
    ...getHandler('error-probe.ts', 'succeed'),
    response: {
      status: 200
    }
  };

  return {
    name: 'corsApi',
    services: {},
    variables: {},
    cors,
    defaults: {
      scope: {
        clientVersion: 'X-Client-Version'
      }
    },
    routes: [
      {
        path: 'GET /items',
        cors: true,
        handler
      },
      {
        path: 'POST /items',
        cors: true,
        handler: {
          ...handler,
          request: {
            headers: {
              type: 'object',
              properties: {
                'x-idempotency-key': {
                  type: 'string'
                }
              }
            }
          }
        }
      },
      {
        path: 'DELETE /items/{id}',
        handler
      },
      {
        path: 'ANY /hooks',
        handler
      }
    ]
  } as unknown as HttpService;
};

const declaredCors: HttpCors = {
  allowOrigins: [ORIGIN],
  allowHeaders: ['Authorization'],
  exposeHeaders: ['x-trace-id'],
  maxAge: 300
};

const getPreflight = (origin: string, method: string, headers?: string) => {
  return getRequest('OPTIONS', '/items', {
    origin,
    ['access-control-request-method']: method,
    ...(headers && {
      ['access-control-request-headers']: headers
    })
  });
};

describe('local gateway cors', () => {
  const api = registerHttpLocalService(getCorsService(declaredCors), serveOptions, emulateContext);

  it('assert :: preflight from an allowed origin', () => {
    deepEqual(api.corsHandler(getPreflight(ORIGIN, 'POST', 'Content-Type, X-Idempotency-Key')), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-allow-methods']: 'GET,POST',
      ['access-control-allow-headers']: 'authorization,x-trace-id,x-client-version,x-idempotency-key,content-type',
      ['access-control-allow-credentials']: 'true',
      ['access-control-max-age']: '300'
    });
  });

  it('assert :: preflight from another origin', () => {
    deepEqual(api.corsHandler(getPreflight('https://other.test', 'POST')), {});
  });

  it('assert :: preflight with a method not allowed', () => {
    deepEqual(api.corsHandler(getPreflight(ORIGIN, 'DELETE')), {});
  });

  it('assert :: preflight with a header not allowed', () => {
    deepEqual(api.corsHandler(getPreflight(ORIGIN, 'POST', 'x-idempotency-key, x-unknown')), {});
  });

  it('assert :: response to an allowed origin', () => {
    deepEqual(api.corsHandler(getRequest('GET', '/items', { origin: ORIGIN })), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-allow-credentials']: 'true',
      ['access-control-expose-headers']: 'x-trace-id'
    });
  });

  it('assert :: response to another origin', () => {
    deepEqual(api.corsHandler(getRequest('GET', '/items', { origin: 'https://other.test' })), {});
  });

  it('assert :: response without origin', () => {
    deepEqual(api.corsHandler(getRequest('GET', '/items')), {});
  });

  it('assert :: any origin', () => {
    const anyApi = registerHttpLocalService(getCorsService({ allowOrigins: ['*'] }), serveOptions, emulateContext);

    deepEqual(anyApi.corsHandler(getRequest('GET', '/items', { origin: ORIGIN })), {
      ['access-control-allow-origin']: '*'
    });
  });

  it('assert :: any origin of a scheme', () => {
    const httpsApi = registerHttpLocalService(getCorsService({ allowOrigins: ['https://*'] }), serveOptions, emulateContext);

    deepEqual(httpsApi.corsHandler(getRequest('GET', '/items', { origin: ORIGIN })), {
      ['access-control-allow-origin']: ORIGIN
    });

    deepEqual(httpsApi.corsHandler(getRequest('GET', '/items', { origin: 'http://app.test' })), {});
  });

  it('assert :: gateway without cors', async () => {
    const plainApi = registerHttpLocalService(getCorsService(), serveOptions, emulateContext);

    equal(plainApi.corsHandler(getRequest('GET', '/items', { origin: ORIGIN })), undefined);

    const response = (await plainApi.requestHandler(getPreflight(ORIGIN, 'POST'))) as EmulatorResponse;

    equal(response.status, 404);
  });

  it('assert :: gateway answers the preflight no route takes', async () => {
    deepEqual(await api.requestHandler(getPreflight(ORIGIN, 'POST')), {
      status: 204
    });
  });

  it('assert :: route that takes the preflight answers it', async () => {
    const response = (await api.requestHandler({ ...getPreflight(ORIGIN, 'POST'), path: '/hooks' })) as EmulatorResponse;

    equal(response.status, 200);
    equal(response.headers?.['x-custom'], 'custom');
  });
});
