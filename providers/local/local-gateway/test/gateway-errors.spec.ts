import type { EmulatorResponse } from '@ez4/project/library';
import type { HttpService } from '@ez4/gateway/library';

import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { registerHttpLocalService } from '../src/provider/http/local';
import { emulateContext, getHandler, getRequest, serveOptions } from './common/emulator';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const getRoute = (path: string, name: string, httpErrors?: Record<string, number>) => {
  return {
    path,
    httpErrors,
    handler: {
      ...getHandler('error-probe.ts', name),
      response: {
        status: 200
      }
    }
  };
};

const errorService = {
  name: 'errorApi',
  services: {},
  variables: {},
  defaults: {
    httpErrors: {
      PaymentLockedError: 423
    }
  },
  routes: [
    getRoute('GET /succeed', 'succeed'),
    getRoute('GET /unexpected', 'failUnexpectedly'),
    getRoute('GET /non-error', 'failWithoutError'),
    getRoute('GET /http-error', 'failWithHttpError'),
    getRoute('GET /rate-limit', 'failWithRateLimit'),
    getRoute('GET /reserved-headers', 'failWithReservedHeaders'),
    getRoute('GET /service-error', 'failWithServiceError', { OrderLockedError: 423 }),
    getRoute('GET /mapped-error', 'failWithMappedError')
  ]
} as unknown as HttpService;

const getJsonResponse = (status: number, traceId: string, body: unknown) => {
  return {
    status,
    body: JSON.stringify(body),
    headers: {
      ['content-type']: 'application/json',
      ['x-trace-id']: traceId
    }
  };
};

describe('local gateway errors', () => {
  const api = registerHttpLocalService(errorService, serveOptions, emulateContext);

  const sendRequest = async (path: string, traceId?: string) => {
    const headers = traceId ? { 'x-trace-id': traceId } : undefined;

    return (await api.requestHandler(getRequest('GET', path, headers))) as EmulatorResponse;
  };

  it('assert :: success carries the trace id', async () => {
    deepEqual(await sendRequest('/succeed', 'trace-succeed'), {
      status: 200,
      headers: {
        ['x-custom']: 'custom',
        ['x-trace-id']: 'trace-succeed'
      }
    });
  });

  it('assert :: success without a trace id gets a new one', async () => {
    const response = await sendRequest('/succeed');

    match(response.headers?.['x-trace-id'] ?? '', UUID_PATTERN);
  });

  it('assert :: unexpected error answers an internal error', async (t) => {
    const logError = t.mock.method(Logger, 'error', () => {});

    deepEqual(
      await sendRequest('/unexpected', 'trace-unexpected'),
      getJsonResponse(500, 'trace-unexpected', {
        type: 'error',
        message: 'Internal server error'
      })
    );

    ok(logError.mock.calls.some(({ arguments: [message] }) => message?.includes('Connection refused by db.internal:5432')));
  });

  it('assert :: thrown value answers an internal error', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    deepEqual(
      await sendRequest('/non-error', 'trace-non-error'),
      getJsonResponse(500, 'trace-non-error', {
        type: 'error',
        message: 'Internal server error'
      })
    );
  });

  it('assert :: http error answers its status and context', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    deepEqual(
      await sendRequest('/http-error', 'trace-http-error'),
      getJsonResponse(409, 'trace-http-error', {
        type: 'error',
        message: 'Order exists.',
        context: {
          orderId: 'order-1'
        }
      })
    );
  });

  it('assert :: http error answers its headers', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    const response = await sendRequest('/rate-limit', 'trace-rate-limit');

    deepEqual(response, {
      status: 429,
      body: JSON.stringify({
        type: 'error',
        message: 'Slow down.'
      }),
      headers: {
        ['retry-after']: '30',
        ['content-type']: 'application/json',
        ['x-trace-id']: 'trace-rate-limit'
      }
    });
  });

  it('assert :: http error headers keep the content type and trace id', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    const response = await sendRequest('/reserved-headers', 'trace-reserved-headers');

    deepEqual(response.headers, {
      ['retry-after']: '30',
      ['content-type']: 'application/json',
      ['x-trace-id']: 'trace-reserved-headers'
    });
  });

  it('assert :: mapped service error answers its context', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    deepEqual(
      await sendRequest('/service-error', 'trace-service-error'),
      getJsonResponse(423, 'trace-service-error', {
        type: 'error',
        message: 'Order is locked.',
        context: {
          orderId: 'order-1'
        }
      })
    );
  });

  it('assert :: mapped error from the defaults answers its status', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    deepEqual(
      await sendRequest('/mapped-error', 'trace-mapped-error'),
      getJsonResponse(423, 'trace-mapped-error', {
        type: 'error',
        message: 'Payment is locked.'
      })
    );
  });

  it('assert :: route not found answers without a trace id', async () => {
    const response = await sendRequest('/unknown', 'trace-unknown');

    equal(response.status, 404);
    equal(response.headers?.['x-trace-id'], undefined);
  });
});
