import type { Client, Queue } from '@ez4/queue';
import type { Mock } from 'node:test';

import { isQueueImport, isQueueService } from '@ez4/queue/library';
import { Tester } from '@ez4/project/library';

import { mock } from 'node:test';

import { createClientMock } from '../client/mock';

// A tracker of its own, so `mock.restoreAll()` in another spec of the same process leaves these mocks alone.
const tracker = new (mock.constructor as new () => typeof mock)();

export namespace QueueTester {
  export type ClientMock<T extends Queue.Message, U extends Queue.Mode> = Client<T, U> & {
    receiveMessage: Mock<Client<T, U>['receiveMessage']>;
    sendMessage: Mock<Client<T, U>['sendMessage']>;

    /**
     * Messages as the consumer receives them: validated and trimmed by the queue schema.
     * Empty when the tester doesn't know the queue.
     */
    readonly delivered: T[];
  };

  export type ClientMode<T extends Queue.Service<any, Queue.Mode>> = T extends { fairMode: never }
    ? { fifoMode: true }
    : { fairMode: true };

  export const getClient = <T extends Queue.Service<any, Queue.Mode>>(resourceName: string) => {
    return Tester.getServiceClient(resourceName) as Client<T['schema'], ClientMode<T>>;
  };

  export const getClientMock = <T extends Queue.Service<any, Queue.Mode>>(resourceName: string) => {
    const client = createClientMock(resourceName, getQueueContract(resourceName)) as ClientMock<T['schema'], ClientMode<T>>;

    tracker.method(client, 'sendMessage');
    tracker.method(client, 'receiveMessage');

    return client;
  };

  export const setClientMock = <T extends Queue.Service<any, Queue.Mode>>(resourceName: string) => {
    const client = getClientMock<T>(resourceName);

    Tester.mockServiceClient(resourceName, client);

    return client;
  };

  export const restoreClient = (resourceName: string) => {
    Tester.restoreServiceClient(resourceName);
  };
}

const getQueueContract = (resourceName: string) => {
  const service = Tester.getServiceMetadata(resourceName);

  if (service && (isQueueService(service) || isQueueImport(service))) {
    return service;
  }

  return undefined;
};
