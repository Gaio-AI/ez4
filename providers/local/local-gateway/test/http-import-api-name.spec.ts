import type { HttpImport, HttpService } from '@ez4/gateway/library';
import type { HttpClientRequest } from '@ez4/gateway';
import type { ServeOptions } from '@ez4/project/library';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getServiceName } from '@ez4/project/library';

import { registerHttpRemoteService } from '../src/provider/http/remote';
import { registerHttpLocalService } from '../src/provider/http/local';
import { emulateContext, serveOptions } from './common/emulator';
import { startServer } from './common/server';

type TestClient = Record<string, (request: HttpClientRequest) => Promise<unknown>>;

// The name API Gateway shows, which is what a deployed import finds the API by.
const apiName = 'Internal API (Test)';

const ownerOptions = {
  prefix: 'ez4',
  projectName: 'owner',
  branchName: ''
};

const routes = [
  {
    name: 'getItem',
    path: 'GET /items',
    handler: {
      response: {
        status: 204
      }
    }
  }
];

const getImport = (displayName?: string) => {
  return {
    type: '@ez4/import:http',
    name: 'OwnerApi',
    reference: 'TrackingApi',
    project: 'owner',
    displayName,
    services: {},
    variables: {},
    routes
  } as unknown as HttpImport;
};

describe('local gateway import by api name', () => {
  it('assert :: an api with a name is also served under it', () => {
    const service = {
      name: 'InternalApi',
      displayName: apiName,
      services: {},
      variables: {},
      routes
    } as unknown as HttpService;

    const emulator = registerHttpLocalService(service, serveOptions, emulateContext);

    equal(emulator.identifier, getServiceName('InternalApi', serveOptions));
    deepEqual(emulator.aliases, [getServiceName(apiName, serveOptions)]);
  });

  it('assert :: an import of a named api calls the owner by that name', async () => {
    const server = await startServer(() => ({ status: 204 }));

    try {
      const options = {
        ...serveOptions,
        imports: {
          owner: {
            ...ownerOptions,
            serviceHost: server.host
          }
        }
      } as ServeOptions;

      const client = registerHttpRemoteService(getImport(apiName), options, emulateContext).exportHandler() as TestClient;

      await client.getItem!({});

      equal(server.received[0]?.url, `/${getServiceName(apiName, ownerOptions)}/items`);
    } finally {
      await server.close();
    }
  });

  it('assert :: an import of an api without a name calls the owner by class', async () => {
    const server = await startServer(() => ({ status: 204 }));

    try {
      const options = {
        ...serveOptions,
        imports: {
          owner: {
            ...ownerOptions,
            serviceHost: server.host
          }
        }
      } as ServeOptions;

      const client = registerHttpRemoteService(getImport(), options, emulateContext).exportHandler() as TestClient;

      await client.getItem!({});

      equal(server.received[0]?.url, `/${getServiceName('TrackingApi', ownerOptions)}/items`);
    } finally {
      await server.close();
    }
  });
});
