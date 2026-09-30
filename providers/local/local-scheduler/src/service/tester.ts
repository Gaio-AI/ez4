import type { Client, Cron } from '@ez4/scheduler';
import type { Service } from '@ez4/common';
import type { Mock } from 'node:test';
import type { ClientMockOptions } from '../client/mock';

import { getJsonEvent } from '@ez4/scheduler/utils';
import { isCronService } from '@ez4/scheduler/library';
import { Tester } from '@ez4/project/library';
import { getRandomUUID } from '@ez4/utils';

import { mock } from 'node:test';

import { createClientMock } from '../client/mock';

// A tracker of its own, so `mock.restoreAll()` in another spec of the same process leaves these mocks alone.
const tracker = new (mock.constructor as new () => typeof mock)();

export namespace CronTester {
  export type MockOptions<T extends Cron.Event> = ClientMockOptions<T>;

  export type ClientMock<T extends Cron.Event> = Client<T> & {
    getEvent: Mock<Client<T>['getEvent']>;
    createEvent: Mock<Client<T>['createEvent']>;
    updateEvent: Mock<Client<T>['updateEvent']>;
    deleteEvent: Mock<Client<T>['deleteEvent']>;
  };

  export type IncomingOverrides = Partial<Pick<Cron.Incoming<null>, 'requestId' | 'traceId'>>;

  export const getClient = <T extends Cron.Event>(resourceName: string) => {
    return Tester.getServiceClient(resourceName) as Client<T>;
  };

  export const getClientMock = <T extends Cron.Event>(resourceName: string, options?: MockOptions<T>) => {
    const client = createClientMock(resourceName, options) as ClientMock<T>;

    tracker.method(client, 'getEvent');
    tracker.method(client, 'createEvent');
    tracker.method(client, 'updateEvent');
    tracker.method(client, 'deleteEvent');

    return client;
  };

  export const setClientMock = <T extends Cron.Event>(resourceName: string, options?: MockOptions<T>) => {
    const client = getClientMock<T>(resourceName, options);

    Tester.mockServiceClient(resourceName, client);

    return client;
  };

  export const restoreClient = (resourceName: string) => {
    Tester.restoreServiceClient(resourceName);
  };

  /**
   * Run the target of the scheduler through its emulator with the given event, which the event schema checks first
   * (400 when it refuses it). It resolves once the target ran, whether it failed or not. The target runs in the async
   * context of this call, so the client overrides in `options.services` reach it.
   */
  export const trigger = <T extends Cron.Service<any>>(resourceName: string, event?: T['schema'], options?: Tester.RequestOptions) => {
    return Tester.request(resourceName, { body: event ?? undefined }, options);
  };

  /**
   * Make the request the target of the scheduler receives for the given event, to call the target directly. The event
   * goes through the event schema, as it reaches the runtime, so an event it would refuse fails with its error. Like
   * in the runtime, a scheduler without an event schema gives its target no event.
   */
  export const incoming = async <T extends Cron.Service<any>>(
    resourceName: string,
    event?: T['schema'],
    overrides?: IncomingOverrides
  ): Promise<Cron.Incoming<T['schema']>> => {
    const service = getCronContract(resourceName);

    if (!service) {
      throw new Error(`Scheduler [${resourceName}] isn't a scheduler the tester knows.`);
    }

    const request: Cron.Incoming<Cron.Event | null> = {
      requestId: overrides?.requestId ?? getRandomUUID(),
      traceId: overrides?.traceId ?? getRandomUUID(),
      event: service.schema ? await getJsonEvent(getPayloadEvent(event), service.schema) : null
    };

    return request as Cron.Incoming<T['schema']>;
  };

  /**
   * Get the context the target of the scheduler receives, where a client in `overrides` takes the place of the
   * linked one with its name.
   */
  export const getContext = <T extends Cron.Service<any>>(resourceName: string, overrides?: Partial<Service.Context<T>>) => {
    return Tester.getContext<Service.Context<T>>(resourceName, overrides);
  };
}

// The runtime receives the event as JSON, from the schedule payload.
const getPayloadEvent = (event: unknown) => {
  return event === undefined ? undefined : JSON.parse(JSON.stringify(event));
};

const getCronContract = (resourceName: string) => {
  const service = Tester.getServiceMetadata(resourceName);

  if (service && isCronService(service)) {
    return service;
  }

  return undefined;
};
