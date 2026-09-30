import type { Ws, WsClient } from '@ez4/gateway';
import type { Mock } from 'node:test';
import type { WsClientMockDelivery } from '../../client/ws/mock';

import { isWsService } from '@ez4/gateway/library';
import { Tester } from '@ez4/project/library';

import { mock } from 'node:test';

import { createWsClientMock } from '../../client/ws/mock';

// A tracker of its own, so `mock.restoreAll()` in another spec of the same process leaves these mocks alone.
const tracker = new (mock.constructor as new () => typeof mock)();

export namespace WsTester {
  export type ClientMock<T extends Ws.JsonBody> = WsClient<T> & {
    sendMessage: Mock<WsClient<T>['sendMessage']>;
    disconnect: Mock<WsClient<T>['disconnect']>;

    /**
     * Messages as each connection receives them: serialized by the service schema.
     * Empty when the tester doesn't know the service.
     */
    readonly delivered: WsClientMockDelivery<T>[];
  };

  export const getClient = <T extends Ws.JsonBody>(resourceName: string) => {
    return Tester.getServiceClient(resourceName) as WsClient<T>;
  };

  export const getClientMock = <T extends Ws.JsonBody>(resourceName: string) => {
    const client = createWsClientMock(resourceName, getWsContract(resourceName)) as ClientMock<T>;

    tracker.method(client, 'sendMessage');
    tracker.method(client, 'disconnect');

    return client;
  };

  export const setClientMock = <T extends Ws.JsonBody>(resourceName: string) => {
    const client = getClientMock<T>(resourceName);

    Tester.mockServiceClient(resourceName, client);

    return client;
  };

  export const restoreClient = (resourceName: string) => {
    Tester.restoreServiceClient(resourceName);
  };
}

const getWsContract = (resourceName: string) => {
  const service = Tester.getServiceMetadata(resourceName);

  if (service && isWsService(service)) {
    return service;
  }

  return undefined;
};
