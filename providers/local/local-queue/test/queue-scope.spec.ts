import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { QueueImport, QueueService } from '@ez4/queue/library';
import type { Client } from '@ez4/queue';
import type { ObservedScope } from './fixtures/scope-probe';

import { deepEqual, equal, match } from 'node:assert/strict';
import { afterEach, describe, it, type TestContext } from 'node:test';

import { Runtime } from '@ez4/common';

import { registerLocalService } from '../src/provider/local';
import { registerRemoteService } from '../src/provider/remote';
import { createRemoteClient } from '../src/client/remote';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SCOPE_HEADERS = { clientVersion: 'x-client-version' };

const remoteOptions = {
  prefix: 'ez4',
  projectName: 'other',
  branchName: '',
  serviceHost: 'localhost:0'
};

const options = {
  prefix: 'ez4',
  projectName: 'scope',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {},
  imports: {
    other: remoteOptions
  }
} as ServeOptions;

const context = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

const messageSchema = {
  type: 'object',
  properties: {
    foo: {
      type: 'string'
    }
  }
};

const queueService = {
  type: '@ez4/queue',
  name: 'scopeQueue',
  services: {},
  variables: {},
  schema: messageSchema,
  subscriptions: [
    {
      handler: {
        name: 'probeScope',
        file: 'test/fixtures/scope-probe.ts',
        position: [1, 1]
      }
    }
  ]
} as unknown as QueueService;

const queueImport = {
  type: '@ez4/import:queue',
  name: 'scopeImport',
  reference: 'scopeQueue',
  project: 'other',
  services: {},
  variables: {},
  schema: messageSchema,
  subscriptions: []
} as unknown as QueueImport;

const observeScopes = (count: number) => {
  const observed: ObservedScope[] = [];

  return new Promise<ObservedScope[]>((resolve) => {
    globalThis.observeScope = (entry) => {
      observed.push(entry);

      if (observed.length === count) {
        resolve(observed);
      }
    };
  });
};

const exportScope = (traceId: string) => {
  Runtime.setScope({ traceId, clientVersion: '1.2.3' }, SCOPE_HEADERS);

  return Runtime.exportScope();
};

const mockFetch = (t: TestContext) => {
  return new Promise<Record<string, string>>((resolve) => {
    t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
      resolve(init?.headers as Record<string, string>);
      return new Response(null, { status: 201 });
    });
  });
};

describe('local queue scope', () => {
  afterEach(() => {
    globalThis.observeScope = undefined;
    Runtime.clearScope();
  });

  it('assert :: local client carries trace id and scope to the handler', async () => {
    const client = registerLocalService(queueService, options, context).exportHandler() as Client<{ foo: string }, any>;
    const observed = observeScopes(1);

    Runtime.setScope({ traceId: 'trace-queue', clientVersion: '1.2.3' }, SCOPE_HEADERS);

    await client.sendMessage({ foo: 'bar' });

    Runtime.setScope({ traceId: 'after-send' });

    deepEqual(await observed, [
      {
        scope: {
          traceId: 'trace-queue',
          clientVersion: '1.2.3'
        },
        headers: SCOPE_HEADERS
      }
    ]);
  });

  it('assert :: local client without scope keeps the trace id', async () => {
    const client = registerLocalService(queueService, options, context).exportHandler() as Client<{ foo: string }, any>;
    const observed = observeScopes(1);

    Runtime.setScope({ traceId: 'trace-plain' });

    await client.sendMessage({ foo: 'bar' });

    deepEqual(await observed, [
      {
        scope: {
          traceId: 'trace-plain'
        },
        headers: {}
      }
    ]);
  });

  it('assert :: incoming request restores trace id and scope from headers', async () => {
    const queue = registerLocalService(queueService, options, context);
    const scope = exportScope('trace-remote');

    Runtime.setScope({ traceId: 'receiver' });

    const observed = observeScopes(1);

    const response = await queue.requestHandler({
      method: 'POST',
      path: '/',
      query: {},
      headers: {
        'x-trace-id': 'trace-remote',
        'x-ez4-scope': scope!
      },
      body: Buffer.from(JSON.stringify({ foo: 'bar' }))
    });

    equal(response.status, 201);

    deepEqual(await observed, [
      {
        scope: {
          traceId: 'trace-remote',
          clientVersion: '1.2.3'
        },
        headers: SCOPE_HEADERS
      }
    ]);
  });

  it('assert :: incoming request without trace headers uses a fresh trace id', async () => {
    const queue = registerLocalService(queueService, options, context);
    const observed = observeScopes(1);

    await queue.requestHandler({
      method: 'POST',
      path: '/',
      query: {},
      headers: {},
      body: Buffer.from(JSON.stringify({ foo: 'bar' }))
    });

    const [{ scope }] = await observed;

    match(scope?.traceId ?? '', UUID_PATTERN);
    deepEqual(Object.keys(scope ?? {}), ['traceId']);
  });

  it('assert :: remote client sends trace id and scope headers', async (t) => {
    const sent = mockFetch(t);

    const client = createRemoteClient('scopeQueue', queueService.schema, remoteOptions);
    const scope = exportScope('trace-forward');

    await client.sendMessage({ foo: 'bar' });

    const headers = await sent;

    equal(headers['x-trace-id'], 'trace-forward');
    equal(headers['x-ez4-scope'], scope);
  });

  it('assert :: imported queue forwards the incoming trace headers', async (t) => {
    const sent = mockFetch(t);

    const queue = registerRemoteService(queueImport, options);
    const scope = exportScope('trace-import');

    Runtime.setScope({ traceId: 'receiver' });

    await queue.requestHandler({
      method: 'POST',
      path: '/',
      query: {},
      headers: {
        'x-trace-id': 'trace-import',
        'x-ez4-scope': scope!
      },
      body: Buffer.from(JSON.stringify({ foo: 'bar' }))
    });

    const headers = await sent;

    equal(headers['x-trace-id'], 'trace-import');
    equal(headers['x-ez4-scope'], scope);
  });
});
