import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { QueueImport, QueueService } from '@ez4/queue/library';
import type { Client } from '@ez4/queue';
import type { ObservedScope } from './fixtures/scope-probe';

import { deepEqual, equal, match } from 'node:assert/strict';
import { afterEach, before, describe, it, type TestContext } from 'node:test';

import { Runtime } from '@ez4/common';

import { registerLocalService } from '../src/provider/local';
import { registerRemoteService } from '../src/provider/remote';
import { createGate, getQueueService, loadProbe, startQueue, useQueueProbe } from './queue';
import { startTestServer } from './server';
import { waitFor } from './clock';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SCOPE_HEADERS = { clientVersion: 'x-client-version' };

const getOptions = (ownerHost: string) => {
  return {
    prefix: 'ez4',
    projectName: 'scope',
    branchName: '',
    serviceHost: 'localhost:0',
    version: 1,
    localOptions: {},
    testOptions: {},
    imports: {
      other: {
        prefix: 'ez4',
        projectName: 'other',
        branchName: '',
        serviceHost: ownerHost
      }
    }
  } as ServeOptions;
};

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

const startScopeQueue = async (t: TestContext) => {
  const queue = registerLocalService(queueService, getOptions('localhost:0'), context);

  t.after(() => queue.shutdownHandler?.());

  await queue.bootstrapHandler?.();

  return queue;
};

const startOwner = async (t: TestContext) => {
  const owner = await startTestServer();

  t.after(() => owner.close());

  return owner;
};

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

describe('local queue scope', () => {
  before(() => loadProbe());

  afterEach(() => {
    globalThis.observeScope = undefined;
    Runtime.clearScope();
  });

  it('assert :: local client carries trace id and scope to the handler', async (t) => {
    const queue = await startScopeQueue(t);
    const client = queue.exportHandler() as Client<{ foo: string }, any>;
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

    // The delivery runs in a scope of its own and leaves the one of the process alone.
    equal(Runtime.getScope()?.traceId, 'after-send');
  });

  it('assert :: local client without scope keeps the trace id', async (t) => {
    const queue = await startScopeQueue(t);
    const client = queue.exportHandler() as Client<{ foo: string }, any>;
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

  it('assert :: incoming request restores trace id and scope from headers', async (t) => {
    const queue = await startScopeQueue(t);
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

  it('assert :: incoming request without trace headers uses a fresh trace id', async (t) => {
    const queue = await startScopeQueue(t);
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

  it('assert :: concurrent deliveries keep their own trace id', async (t) => {
    const probe = useQueueProbe(t);

    const gates = {
      a: createGate(),
      b: createGate()
    };

    const observed: Record<string, (string | undefined)[]> = {};

    probe.setHandler(async ({ message }) => {
      const gate = message.id === 'a' ? gates.a : gates.b;
      const startTraceId = Runtime.getScope()?.traceId;

      await gate.promise;

      observed[message.id] = [startTraceId, Runtime.getScope()?.traceId];
    });

    const { client } = await startQueue(t, getQueueService('concurrentScopeQueue'));

    Runtime.setScope({ traceId: 'trace-a' });

    await client.sendMessage({ id: 'a' });
    await waitFor(() => probe.requests.length === 1);

    Runtime.setScope({ traceId: 'trace-b' });

    await client.sendMessage({ id: 'b' });
    await waitFor(() => probe.requests.length === 2);

    gates.a.open();
    gates.b.open();

    await waitFor(() => Object.keys(observed).length === 2);

    deepEqual(observed, {
      a: ['trace-a', 'trace-a'],
      b: ['trace-b', 'trace-b']
    });
  });

  it('assert :: remote client sends trace id and scope headers', async (t) => {
    const owner = await startOwner(t);

    const queue = registerRemoteService(queueImport, getOptions(owner.host));

    t.after(() => queue.shutdownHandler?.());

    const client = queue.exportHandler() as Client<{ foo: string }, any>;
    const scope = exportScope('trace-forward');

    await client.sendMessage({ foo: 'bar' });

    await waitFor(() => owner.requests.length === 1);

    const [{ headers }] = owner.requests;

    equal(headers['x-trace-id'], 'trace-forward');
    equal(headers['x-ez4-scope'], scope);
  });

  it('assert :: imported queue forwards the incoming trace headers', async (t) => {
    const owner = await startOwner(t);

    const queue = registerRemoteService(queueImport, getOptions(owner.host));

    t.after(() => queue.shutdownHandler?.());

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

    await waitFor(() => owner.requests.length === 1);

    const [{ headers }] = owner.requests;

    equal(headers['x-trace-id'], 'trace-import');
    equal(headers['x-ez4-scope'], scope);

    // Each forward imports the incoming scope into a scope of its own.
    equal(Runtime.getScope()?.traceId, 'receiver');
  });
});
