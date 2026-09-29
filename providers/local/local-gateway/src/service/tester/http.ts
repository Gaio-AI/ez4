import type { HttpClient, HttpClientResponse, Http } from '@ez4/gateway';
import type { Mock } from 'node:test';
import type { HttpClientMockOperation } from '../../client/http/mock';

import { isHttpImport, isHttpService } from '@ez4/gateway/library';
import { Tester } from '@ez4/project/library';

import { createHttpClientMock } from '../../client/http/mock';

export namespace HttpTester {
  export type MockOptions<T extends Http.Service> = {
    default: HttpClientMockOperation | HttpClientResponse;
    operations?: {
      [P in keyof HttpClient<T>]?: HttpClient<T>[P] | Awaited<ReturnType<HttpClient<T>[P]>>;
    };
  };

  export type ClientMock<T extends Http.Service> = {
    [P in keyof HttpClient<T>]: Mock<HttpClient<T>[P]>;
  };

  export const getClient = <T extends Http.Service>(resourceName: string) => {
    return Tester.getServiceClient(resourceName) as HttpClient<T>;
  };

  /**
   * Get a client mock for the given service. When the tester knows the service, each request is checked the way
   * the service checks it (400 for an invalid body, query or path) and each response body reaches the caller the
   * way the real client delivers it.
   */
  export const getClientMock = <T extends Http.Service>(resourceName: string, options: MockOptions<T>) => {
    return createHttpClientMock(resourceName, options, getHttpContract(resourceName)) as ClientMock<T>;
  };

  export const setClientMock = <T extends Http.Service>(resourceName: string, options: MockOptions<T>) => {
    const client = getClientMock<T>(resourceName, options);

    Tester.mockServiceClient(resourceName, client);

    return client;
  };

  export const restoreClient = (resourceName: string) => {
    Tester.restoreServiceClient(resourceName);
  };
}

const getHttpContract = (resourceName: string) => {
  const service = Tester.getServiceMetadata(resourceName);

  if (service && (isHttpService(service) || isHttpImport(service))) {
    return service;
  }

  return undefined;
};
