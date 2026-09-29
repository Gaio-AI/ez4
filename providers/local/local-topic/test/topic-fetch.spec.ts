import type { TopicRemoteSubscription } from '../src/types/subscription';
import type { EventSchema } from '@ez4/topic/utils';

import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { processRemoteEvent } from '../src/handlers/remote';
import { createRemoteClient } from '../src/client/remote';
import { startTestServer } from './server';
import { waitFor } from './clock';

const eventSchema = {
  type: 'object',
  properties: {
    foo: {
      type: 'string'
    }
  }
} as unknown as EventSchema;

const stubFetch = () => {
  return Promise.resolve(new Response(null, { status: 201 }));
};

describe('local topic native fetch', () => {
  it('assert :: remote subscription request skips a stubbed fetch', async (t) => {
    const subscriber = await startTestServer();

    const subscription = {
      type: 'remote',
      resourceName: 'subscriber',
      serviceHost: `http://${subscriber.host}/subscriber`
    } as unknown as TopicRemoteSubscription;

    const stub = t.mock.method(globalThis, 'fetch', stubFetch);

    try {
      await processRemoteEvent(subscription, { foo: 'bar' }, { traceId: 'trace-fetch' });

      equal(stub.mock.callCount(), 0);
      equal(subscriber.requests.length, 1);
    } finally {
      await subscriber.close();
    }
  });

  it('assert :: remote client request skips a stubbed fetch', async (t) => {
    const owner = await startTestServer();

    const client = createRemoteClient('fetchTopic', eventSchema, {
      prefix: 'ez4',
      projectName: 'owner',
      branchName: '',
      serviceHost: owner.host
    });

    const stub = t.mock.method(globalThis, 'fetch', stubFetch);

    try {
      await client.publishEvent({ foo: 'bar' });

      await waitFor(() => owner.requests.length === 1 || stub.mock.callCount() === 1);

      equal(stub.mock.callCount(), 0);
      equal(owner.requests.length, 1);
    } finally {
      await owner.close();
    }
  });
});
