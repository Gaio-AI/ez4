import type { Client, Topic } from '@ez4/topic';
import type { Service } from '@ez4/common';
import type { Mock } from 'node:test';

import { getJsonEvent, getJsonStringEvent } from '@ez4/topic/utils';
import { isTopicImport, isTopicService } from '@ez4/topic/library';
import { Tester } from '@ez4/project/library';
import { getRandomUUID } from '@ez4/utils';

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

  export type IncomingOverrides = Partial<Pick<Topic.Incoming<Topic.Event>, 'requestId' | 'traceId'>>;

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

  /**
   * Publish an event to the topic through its emulator, which checks it the way the real client does (400 when it
   * refuses it) and resolves once its subscriptions ran, whether they failed or not. The Lambda subscriptions run in
   * the async context of this call, so the client overrides in `options.services` reach them.
   */
  export const publish = <T extends Topic.Service<any, any>>(resourceName: string, event: T['schema'], options?: Tester.RequestOptions) => {
    return Tester.request(resourceName, { body: event }, options);
  };

  /**
   * Make the request a subscription handler receives for the given event, to call the handler directly. The event
   * goes through the topic schema when it's published and again when the runtime takes it, so an event the schema
   * refuses fails with its error.
   */
  export const incoming = async <T extends Topic.Service<any, any>>(
    resourceName: string,
    event: T['schema'],
    overrides?: IncomingOverrides
  ): Promise<Topic.Incoming<T['schema']>> => {
    const service = getTopicContract(resourceName);

    if (!service) {
      throw new Error(`Topic [${resourceName}] isn't a topic the tester knows.`);
    }

    const payload = await getJsonStringEvent(event, service.schema);

    return {
      requestId: overrides?.requestId ?? getRandomUUID(),
      traceId: overrides?.traceId ?? getRandomUUID(),
      event: await getJsonEvent(JSON.parse(payload), service.schema)
    };
  };

  /**
   * Get the context the subscription handlers of the topic receive, where a client in `overrides` takes the place
   * of the linked one with its name.
   */
  export const getContext = <T extends Topic.Service<any, any>>(resourceName: string, overrides?: Partial<Service.Context<T>>) => {
    return Tester.getContext<Service.Context<T>>(resourceName, overrides);
  };
}

const getTopicContract = (resourceName: string) => {
  const service = Tester.getServiceMetadata(resourceName);

  if (service && (isTopicService(service) || isTopicImport(service))) {
    return service;
  }

  return undefined;
};
