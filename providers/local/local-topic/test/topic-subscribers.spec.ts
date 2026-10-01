import type { EmulateServiceContext, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { TopicService } from '@ez4/topic/library';
import type { TestServer } from './server';

import { after, before, describe, it } from 'node:test';
import { equal } from 'node:assert/strict';

import { registerLocalService } from '../src/provider/local';
import { waitFor } from './clock';
import { startTestServer } from './server';

const options = {
  prefix: 'ez4',
  projectName: 'owner',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {}
} as ServeOptions;

const context = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

const topicService = {
  type: '@ez4/topic',
  name: 'sharedTopic',
  services: {},
  variables: {},
  subscriptions: [],
  schema: {
    type: 'object',
    properties: {
      foo: {
        type: 'string'
      }
    }
  }
} as unknown as TopicService;

const getRequest = (path: string, body: object): EmulatorRequestEvent => {
  return {
    method: 'POST',
    path,
    query: {},
    headers: {},
    body: Buffer.from(JSON.stringify(body))
  };
};

// Every project that imports a topic subscribes with the name of the topic it imports, which is the same for all of them.
const subscribe = (server: TestServer) => {
  return getRequest('/subscribe', { resourceName: 'sharedTopic', serviceHost: `http://${server.host}/consumer-topic` });
};

const unsubscribe = (server: TestServer) => {
  return getRequest('/unsubscribe', { resourceName: 'sharedTopic', serviceHost: `http://${server.host}/consumer-topic` });
};

const publish = getRequest('/', { foo: 'bar' });

describe('local topic remote subscribers', () => {
  const servers: TestServer[] = [];

  before(async () => {
    servers.push(await startTestServer(), await startTestServer());
  });

  after(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  it('assert :: two projects subscribed to the same topic both receive its events', async () => {
    const [first, second] = servers;
    const topic = registerLocalService(topicService, options, context);

    await topic.requestHandler(subscribe(first!));
    await topic.requestHandler(subscribe(second!));
    await topic.requestHandler(publish);

    await waitFor(() => first!.requests.length === 1 && second!.requests.length === 1);

    equal(first!.requests.length, 1);
    equal(second!.requests.length, 1);

    // One project shutting down leaves the other subscribed.
    await topic.requestHandler(unsubscribe(first!));
    await topic.requestHandler(publish);

    await waitFor(() => second!.requests.length === 2);

    equal(first!.requests.length, 1);
    equal(second!.requests.length, 2);

    await topic.requestHandler(unsubscribe(second!));
  });
});
