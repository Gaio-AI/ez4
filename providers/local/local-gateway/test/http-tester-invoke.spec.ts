import type { CreateItemRequest, ItemsApi, ItemsProvider } from './fixtures/items';
import type { Http } from '@ez4/gateway';

import { deepEqual, equal, match } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { HttpTester } from '../src/service/tester/http';
import { createItem } from './fixtures/items';

describe('local gateway tester invoke', () => {
  beforeEach(() => {
    globalThis.authorizedHeaders = [];
  });

  afterEach(() => {
    globalThis.authorizedHeaders = undefined;
  });

  it('assert :: request a route through the gateway emulator', async () => {
    const response = await HttpTester.request<ItemsApi>('ItemsApi', {
      method: 'POST',
      path: '/items/item-1',
      body: {
        name: 'Lamp'
      }
    });

    equal(response.status, 201);
    equal(response.headers['content-type'], 'application/json');

    deepEqual(response.body, { itemId: 'item-1', name: 'Lamp', region: 'local' });
  });

  it('assert :: request a route with client overrides', async () => {
    const response = await HttpTester.request<ItemsApi>(
      'ItemsApi',
      {
        method: 'POST',
        path: '/items/item-2',
        body: {
          name: 'Desk'
        }
      },
      {
        services: {
          ['@variables']: {
            ITEMS_REGION: 'override'
          }
        }
      }
    );

    deepEqual(response.body, { itemId: 'item-2', name: 'Desk', region: 'override' });
  });

  it('assert :: request a route with a body it refuses', async () => {
    const response = await HttpTester.request<ItemsApi>('ItemsApi', {
      method: 'POST',
      path: '/items/item-3',
      body: {
        // @ts-expect-error The route contract refuses it as well.
        title: 'Lamp'
      }
    });

    equal(response.status, 400);
    match(JSON.stringify(response.body), /"message":"Malformed body payload\."/);
  });

  it('assert :: request a route the service lacks', async () => {
    // @ts-expect-error No route of the service takes it.
    const response = await HttpTester.request<ItemsApi>('ItemsApi', { method: 'DELETE', path: '/items/item-4' });

    equal(response.status, 404);
  });

  it('assert :: request a route behind an authorizer with an identity', async () => {
    const response = await HttpTester.request<ItemsApi>(
      'ItemsApi',
      {
        method: 'GET',
        path: '/items/item-5'
      },
      {
        identity: {
          userId: 'user-1',
          role: 'viewer'
        }
      }
    );

    equal(response.status, 200);

    deepEqual(response.body, { itemId: 'item-5', userId: 'user-1', role: 'viewer' });

    // The authorizer didn't run.
    deepEqual(globalThis.authorizedHeaders, []);
  });

  it('assert :: request a route behind an authorizer with an identity it refuses', async () => {
    const response = await HttpTester.request<ItemsApi>(
      'ItemsApi',
      {
        method: 'GET',
        path: '/items/item-6'
      },
      {
        identity: {
          userId: 'user-1'
        }
      }
    );

    equal(response.status, 400);

    // Refused by the identity schema of the route, the way it refuses the identity of an authorizer.
    match(JSON.stringify(response.body), /"message":"Malformed authorizer identity\."/);

    deepEqual(globalThis.authorizedHeaders, []);
  });

  it('assert :: request a route behind an authorizer without an identity', async () => {
    const allowed = await HttpTester.request<ItemsApi>('ItemsApi', {
      method: 'GET',
      path: '/items/item-7',
      headers: {
        Authorization: 'Bearer admin'
      }
    });

    equal(allowed.status, 200);

    deepEqual(allowed.body, { itemId: 'item-7', userId: 'from-authorizer', role: 'admin' });

    const denied = await HttpTester.request<ItemsApi>('ItemsApi', {
      method: 'GET',
      path: '/items/item-8',
      headers: {
        Authorization: 'Bearer guest'
      }
    });

    equal(denied.status, 403);

    deepEqual(globalThis.authorizedHeaders, ['Bearer admin', 'Bearer guest']);
  });

  it('assert :: call a route handler with its context', () => {
    const request: Http.Incoming<CreateItemRequest> = {
      requestId: 'request-1',
      timestamp: new Date(),
      method: 'POST',
      path: '/items/item-9',
      parameters: {
        itemId: 'item-9'
      },
      body: {
        name: 'Chair'
      }
    };

    const context = HttpTester.getContext<ItemsProvider>('ItemsApi', {
      variables: {
        ITEMS_REGION: 'direct'
      }
    });

    deepEqual(createItem(request, context), {
      status: 201,
      body: {
        itemId: 'item-9',
        name: 'Chair',
        region: 'direct'
      }
    });
  });
});
