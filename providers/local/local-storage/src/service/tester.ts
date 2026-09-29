import type { Client } from '@ez4/storage';
import type { Mock } from 'node:test';
import type { ClientMockOptions } from '../client/mock';

import { Tester } from '@ez4/project/library';

import { mock } from 'node:test';

import { createClientMock } from '../client/mock';

// A tracker of its own, so `mock.restoreAll()` in another spec of the same process leaves these mocks alone.
const tracker = new (mock.constructor as new () => typeof mock)();

export namespace BucketTester {
  export type MockOptions = ClientMockOptions;

  export type ClientMock = Client & {
    stat: Mock<Client['stat']>;
    exists: Mock<Client['exists']>;
    write: Mock<Client['write']>;
    read: Mock<Client['read']>;
    delete: Mock<Client['delete']>;
    copy: Mock<Client['copy']>;
    scan: Mock<Client['scan']>;
    getStatUrl: Mock<Client['getStatUrl']>;
    getWriteUrl: Mock<Client['getWriteUrl']>;
    getReadUrl: Mock<Client['getReadUrl']>;
  };

  export const getClient = (resourceName: string) => {
    return Tester.getServiceClient(resourceName) as Client;
  };

  export const getClientMock = (resourceName: string, options?: MockOptions) => {
    const client = createClientMock(resourceName, options);

    tracker.method(client, 'stat');
    tracker.method(client, 'exists');
    tracker.method(client, 'write');
    tracker.method(client, 'read');
    tracker.method(client, 'delete');
    tracker.method(client, 'copy');
    tracker.method(client, 'scan');

    tracker.method(client, 'getStatUrl');
    tracker.method(client, 'getWriteUrl');
    tracker.method(client, 'getReadUrl');

    return client as ClientMock;
  };

  export const setClientMock = (resourceName: string, options: MockOptions) => {
    const client = getClientMock(resourceName, options);

    Tester.mockServiceClient(resourceName, client);

    return client;
  };

  export const restoreClient = (resourceName: string) => {
    Tester.restoreServiceClient(resourceName);
  };
}
