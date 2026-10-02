import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { deepEqual } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { HttpTooManyRequestsError } from '@ez4/gateway';
import { Runtime } from '@ez4/common';

import { apiEntryPoint as requestEntryPoint } from '../lib/request';
import { lambdaContext, setEntryPointGlobals } from './common/entry-point';

type RequestEvent = Parameters<typeof requestEntryPoint>[0];

class PaymentLockedError extends Error {}

const sendRequest = async (traceId: string) => {
  const event = {
    headers: {
      'x-trace-id': traceId
    },
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

describe('gateway runtime errors', () => {
  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: http error answers its headers', async (t) => {
    t.mock.method(console, 'info', () => {});

    setEntryPointGlobals(undefined, async () => {
      throw new HttpTooManyRequestsError('Slow down.', undefined, { 'retry-after': '30' });
    });

    deepEqual(await sendRequest('trace-rate-limit'), {
      statusCode: 429,
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
    t.mock.method(console, 'info', () => {});

    setEntryPointGlobals(undefined, async () => {
      throw new HttpTooManyRequestsError('Slow down.', undefined, {
        'retry-after': '30',
        'content-type': 'text/plain',
        'X-Trace-Id': 'forged'
      });
    });

    const response = await sendRequest('trace-reserved-headers');

    deepEqual(response.headers, {
      ['retry-after']: '30',
      ['content-type']: 'application/json',
      ['x-trace-id']: 'trace-reserved-headers'
    });
  });

  it('assert :: mapped error answers without extra headers', async (t) => {
    t.mock.method(console, 'info', () => {});

    setEntryPointGlobals(undefined, async () => {
      throw new PaymentLockedError('Payment is locked.');
    });

    Object.assign(globalThis, {
      __EZ4_ERRORS_MAP: {
        PaymentLockedError: 423
      }
    });

    deepEqual(await sendRequest('trace-mapped-error'), {
      statusCode: 423,
      body: JSON.stringify({
        type: 'error',
        message: 'Payment is locked.'
      }),
      headers: {
        ['content-type']: 'application/json',
        ['x-trace-id']: 'trace-mapped-error'
      }
    });
  });
});
