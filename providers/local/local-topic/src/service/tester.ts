import type { Client, Topic } from '@ez4/topic';
import type { Mock } from 'node:test';

import { isTopicImport, isTopicService } from '@ez4/topic/library';
import { Tester } from '@ez4/project/library';

import { mock } from 'node:test';

import { createClientMock } from '../client/mock';

// A tracker of its own, so `mock.restoreAll()` in another spec of the same process leaves these mocks alone.
const tracker = new (mock.constructor as new () => typeof mock)();

export namespace TopicTester {
  export type ClientMock<T extends Topic.Event> = Client<T> & {
    publishEvent: Mock<Client<T>['publishEvent']>;

    /**
     * Events as subscribers receive them: validated and trimmed by the topic schema.
     * Empty when the tester doesn't know the topic.
     */
    readonly delivered: T[];
  };

  export const getClient = <T extends Topic.Service<any, any>>(resourceName: string) => {
    return Tester.getServiceClient(resourceName) as Client<T['schema']>;
  };

  export const getClientMock = <T extends Topic.Service<any, any> = any>(resourceName: string) => {
    const client = createClientMock(resourceName, getTopicContract(resourceName)) as ClientMock<T['schema']>;

    tracker.method(client, 'publishEvent');

    return client;
  };

  export const setClientMock = <T extends Topic.Service<any, any>>(resourceName: string) => {
    const client = getClientMock<T>(resourceName);

    Tester.mockServiceClient(resourceName, client);

    return client;
  };

  export const restoreClient = (resourceName: string) => {
    Tester.restoreServiceClient(resourceName);
  };
}

const getTopicContract = (resourceName: string) => {
  const service = Tester.getServiceMetadata(resourceName);

  if (service && (isTopicService(service) || isTopicImport(service))) {
    return service;
  }

  return undefined;
};
