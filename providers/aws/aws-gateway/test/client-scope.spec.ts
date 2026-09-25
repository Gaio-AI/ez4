import type { HttpClientRequest } from '@ez4/gateway';
import type { TestContext } from 'node:test';

import { equal } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

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

  afterEach(() => {
    Runtime.clearScope();
  });

  const sendRequest = async (t: TestContext, request: HttpClientRequest) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));

    await client.getItems(request);

    return new Headers(fetch.mock.calls[0].arguments[1]?.headers);
  };

  it('assert :: forward scope values under their header names', async (t) => {
    Runtime.setScope({ traceId: 'trace-1', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version', sessionId: 'x-session-id' });

    const headers = await sendRequest(t, {});

    equal(headers.get('x-trace-id'), 'trace-1');
    equal(headers.get('x-client-version'), '1.2.3');
    equal(headers.get('x-session-id'), null);
  });

  it('assert :: request headers override scope headers', async (t) => {
    Runtime.setScope({ traceId: 'trace-2', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version' });

    const headers = await sendRequest(t, {
      headers: {
        'x-client-version': 'explicit'
      }
    });

    equal(headers.get('x-client-version'), 'explicit');
  });

  it('assert :: no scope headers without declaration', async (t) => {
    Runtime.setScope({ traceId: 'trace-3', clientVersion: '1.2.3' });

    const headers = await sendRequest(t, {});

    equal(headers.get('x-trace-id'), 'trace-3');
    equal(headers.get('x-client-version'), null);
  });
});
