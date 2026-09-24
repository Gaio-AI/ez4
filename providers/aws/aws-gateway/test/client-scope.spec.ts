import type { HttpClientRequest } from '@ez4/gateway';

import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Runtime } from '@ez4/common';

import { HttpClient } from '../src/client/http';

type TestClient = Record<string, (request: HttpClientRequest) => Promise<unknown>>;

describe('gateway http client scope', () => {
  const client = HttpClient.make('https://example.test', {
    operations: {
      getItems: {
        method: 'GET',
        path: '/items'
      }
    }
  }) as unknown as TestClient;

  const sendRequest = async (request: HttpClientRequest) => {
    const originalFetch = globalThis.fetch;

    let headers = new Headers();

    globalThis.fetch = async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response(null, { status: 204 });
    };

    try {
      await client.getItems(request);
    } finally {
      globalThis.fetch = originalFetch;
    }

    return headers;
  };

  it('assert :: forward scope values under their header names', async () => {
    Runtime.setScope({ traceId: 'trace-1', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version', sessionId: 'x-session-id' });

    const headers = await sendRequest({});

    equal(headers.get('x-trace-id'), 'trace-1');
    equal(headers.get('x-client-version'), '1.2.3');
    equal(headers.get('x-session-id'), null);
  });

  it('assert :: request headers override scope headers', async () => {
    Runtime.setScope({ traceId: 'trace-2', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version' });

    const headers = await sendRequest({
      headers: {
        'x-client-version': 'explicit'
      }
    });

    equal(headers.get('x-client-version'), 'explicit');
  });

  it('assert :: no scope headers without declaration', async () => {
    Runtime.setScope({ traceId: 'trace-3', clientVersion: '1.2.3' });

    const headers = await sendRequest({});

    equal(headers.get('x-trace-id'), 'trace-3');
    equal(headers.get('x-client-version'), null);
  });
});
