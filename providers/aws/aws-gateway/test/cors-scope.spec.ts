import type { HttpRoute } from '@ez4/gateway/library';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getCorsConfiguration } from '../src/triggers/http/cors';

const getRoute = (path: HttpRoute['path'], route: Partial<HttpRoute> = {}): HttpRoute => {
  return {
    path,
    handler: {
      name: 'testHandler',
      file: 'test.ts',
      position: [1, 1],
      response: {
        status: 204
      }
    },
    ...route
  };
};

describe('gateway cors scope', () => {
  it('assert :: allow trace and scope headers', () => {
    const cors = getCorsConfiguration(
      [
        getRoute('GET /items', { cors: true, scope: { requestSource: 'X-Request-Source' } }),
        getRoute('GET /hidden', { scope: { hidden: 'x-hidden' } })
      ],
      {
        allowOrigins: ['*'],
        allowHeaders: ['Authorization']
      },
      {
        scope: {
          clientVersion: 'X-Client-Version',
          sessionId: 'x-session-id'
        }
      }
    );

    deepEqual(new Set(cors.allowHeaders), new Set(['authorization', 'x-trace-id', 'x-client-version', 'x-session-id', 'x-request-source']));

    deepEqual(cors.allowMethods, ['GET']);
  });

  it('assert :: allow trace header without scope', () => {
    const cors = getCorsConfiguration([], {
      allowOrigins: ['*']
    });

    deepEqual(cors.allowHeaders, ['x-trace-id']);
  });
});
