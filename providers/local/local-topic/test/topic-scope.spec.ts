import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { TopicLambdaSubscription, TopicService } from '@ez4/topic/library';
import type { TopicRemoteSubscription } from '../src/types/subscription';
import type { Client } from '@ez4/topic';
import type { ObservedScope } from './fixtures/scope-probe';

import { deepEqual, equal, match } from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { Runtime } from '@ez4/common';

import { registerLocalService } from '../src/provider/local';
import { processLambdaEvent } from '../src/handlers/lambda';
import { processRemoteEvent } from '../src/handlers/remote';
import { createRemoteClient } from '../src/client/remote';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SCOPE_HEADERS = { clientVersion: 'x-client-version' };

const options = {
  prefix: 'ez4',
  projectName: 'scope',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {}
} as ServeOptions;

const queueClient = {
  sendMessage: async () => {
    globalThis.observeScope?.({
      scope: Runtime.getScope(),
      headers: Runtime.getScopeHeaders()
    });
  }
};

const context = {
  makeClients: () => ({}),
  makeClient: () => queueClient
} as unknown as EmulateServiceContext;

const eventSchema = {
  type: 'object',
  properties: {
    foo: {
      type: 'string'
    }
  }
};

const topicService = {
  type: '@ez4/topic',
  name: 'scopeTopic',
  services: {},
  variables: {},
  schema: eventSchema,
  subscriptions: [
    {
      type: 'lambda',
      handler: {
        name: 'probeScope',
        file: 'test/fixtures/scope-probe.ts',
        position: [1, 1]
      }
    },
    {
      type: 'queue',
      service: 'scopeQueue'
    }
  ]
} as unknown as TopicService;

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

const scopedEntry = (traceId: string) => ({
  scope: {
    traceId,
    clientVersion: '1.2.3'
  },
  headers: SCOPE_HEADERS
});

describe('local topic scope', () => {
  it('assert :: lambda subscriber runs for an event without a handler field', async () => {
    const observed = observeScopes(1);
    const subscription = topicService.subscriptions[0] as TopicLambdaSubscription;

    await processLambdaEvent(topicService, options, context, subscription, { foo: 'bar' }, { traceId: 'trace-direct' });

    deepEqual(await observed, [
      {
        scope: {
          traceId: 'trace-direct'
        },
        headers: {}
      }
    ]);
  });

  it('assert :: local client carries trace id and scope to lambda and queue subscribers', async () => {
    const client = registerLocalService(topicService, options, context).exportHandler() as Client<{ foo: string }>;
    const observed = observeScopes(2);

    Runtime.setScope({ traceId: 'trace-topic', clientVersion: '1.2.3' }, SCOPE_HEADERS);

    await client.publishEvent({ foo: 'bar' });

    Runtime.setScope({ traceId: 'after-publish' });

    deepEqual(await observed, [scopedEntry('trace-topic'), scopedEntry('trace-topic')]);
  });

  it('assert :: local client without scope keeps the trace id', async () => {
    const client = registerLocalService(topicService, options, context).exportHandler() as Client<{ foo: string }>;
    const observed = observeScopes(2);

    Runtime.setScope({ traceId: 'trace-plain' });

    await client.publishEvent({ foo: 'bar' });

    const plainEntry = {
      scope: {
        traceId: 'trace-plain'
      },
      headers: {}
    };

    deepEqual(await observed, [plainEntry, plainEntry]);
  });

  it('assert :: incoming request restores trace id and scope from headers', async () => {
    const topic = registerLocalService(topicService, options, context);
    const scope = exportScope('trace-remote');

    Runtime.setScope({ traceId: 'receiver' });

    const observed = observeScopes(2);

    const response = await topic.requestHandler({
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

    deepEqual(await observed, [scopedEntry('trace-remote'), scopedEntry('trace-remote')]);
  });

  it('assert :: incoming request without trace headers uses a fresh trace id', async () => {
    const topic = registerLocalService(topicService, options, context);
    const observed = observeScopes(2);

    await topic.requestHandler({
      method: 'POST',
      path: '/',
      query: {},
      headers: {},
      body: Buffer.from(JSON.stringify({ foo: 'bar' }))
    });

    for (const { scope } of await observed) {
      match(scope?.traceId ?? '', UUID_PATTERN);
      deepEqual(Object.keys(scope ?? {}), ['traceId']);
    }
  });

  it('assert :: remote subscriber receives trace headers', async (t) => {
    const sent = mockFetch(t);
    const scope = exportScope('trace-subscriber');

    const subscription = {
      type: 'remote',
      resourceName: 'subscriber',
      serviceHost: 'http://localhost:0/subscriber'
    } as unknown as TopicRemoteSubscription;

    await processRemoteEvent(subscription, { foo: 'bar' }, { traceId: 'trace-subscriber', scope });

    const headers = await sent;

    equal(headers['x-trace-id'], 'trace-subscriber');
    equal(headers['x-ez4-scope'], scope);
  });

  it('assert :: remote client sends trace headers', async (t) => {
    const sent = mockFetch(t);

    const client = createRemoteClient('scopeTopic', topicService.schema, {
      prefix: 'ez4',
      projectName: 'other',
      branchName: '',
      serviceHost: 'localhost:0'
    });

    const scope = exportScope('trace-publish');

    await client.publishEvent({ foo: 'bar' });

    const headers = await sent;

    equal(headers['x-trace-id'], 'trace-publish');
    equal(headers['x-ez4-scope'], scope);
  });
});
