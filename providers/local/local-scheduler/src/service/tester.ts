import type { Client, Cron } from '@ez4/scheduler';
import type { Mock } from 'node:test';
import type { ClientMockOptions } from '../client/mock';

import { Tester } from '@ez4/project/library';

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
}
