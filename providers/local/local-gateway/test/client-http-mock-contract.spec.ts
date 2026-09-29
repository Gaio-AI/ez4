import type { HttpImport } from '@ez4/gateway/library';
import type { Http, HttpClientResponse } from '@ez4/gateway';

import { describe, it, mock } from 'node:test';
import { deepEqual, equal, ok, rejects, throws } from 'node:assert/strict';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';

import { createHttpClientMock } from '../src/client/http/mock';
import { HttpTester } from '../src/service/tester/http';

declare class ContractApi extends Http.Service {
  routes: [
    Http.UseRoute<{
      name: 'createItem';
      path: 'POST /items/{itemId}';
      handler: (request: CreateItemRequest) => CreateItemResponse;
    }>,
    Http.UseRoute<{
      name: 'deleteItem';
      path: 'DELETE /items/{itemId}';
      handler: (request: DeleteItemRequest) => DeleteItemResponse;
    }>
  ];
}

type DeleteItemRequest = {
  parameters: {
    itemId: string;
  };
};

type DeleteItemResponse = {
  status: 204;
};

type CreateItemRequest = {
  parameters: {
    itemId: string;
  };
  query: {
    dryRun?: boolean;
  };
  body: {
    itemName: string;
    itemNote?: string;
  };
};

type CreateItemResponse = {
  status: 201;
  body: {
    itemId: string;
    createdAt: string;
  };
};

// Requests the service contract refuses, which the typed client wouldn't let a test write.
type AnyRequest = any;

const httpImport = {
  type: '@ez4/import:http',
  name: 'contractApi',
  reference: 'contractApi',
  project: 'other',
  services: {},
  variables: {},
  defaults: {
    preferences: {
      namingStyle: 'snake'
    }
  },
  routes: [
    {
      name: 'createItem',
      path: 'POST /items/{itemId}',
      handler: {
        name: 'createItem',
        file: 'handler.ts',
        request: {
          parameters: {
            type: 'object',
            properties: {
              itemId: {
                type: 'string',
                format: 'uuid'
              }
            }
          },
          query: {
            type: 'object',
            properties: {
              dryRun: {
                type: 'boolean',
                optional: true
              }
            }
          },
          body: {
            type: 'object',
            properties: {
              itemName: {
                type: 'string'
              },
              itemNote: {
                type: 'string',
                optional: true
              }
            }
          }
        },
        response: {
          status: 201,
          body: {
            type: 'object',
            properties: {
              itemId: {
                type: 'string'
              },
              createdAt: {
                type: 'string'
              }
            }
          }
        }
      }
    },
    {
      name: 'deleteItem',
      path: 'DELETE /items/{itemId}',
      handler: {
        name: 'deleteItem',
        file: 'handler.ts',
        request: {
          parameters: {
            type: 'object',
            properties: {
              itemId: {
                type: 'string'
              }
            }
          }
        },
        response: {
          status: 204
        }
      }
    }
  ]
} as unknown as HttpImport;

const ITEM_ID = '00000000-0000-4000-8000-000000000001';

describe('local gateway http client mock contract', () => {
  const getClient = (response: HttpClientResponse) => {
    return createHttpClientMock<ContractApi>('contractApi', { default: response }, httpImport);
  };

  const createdResponse = {
    status: 201,
    body: {
      itemId: ITEM_ID,
      createdAt: '2026-09-29T00:00:00.000Z',
      unknownField: 'not in the response contract'
    }
  };

  it('assert :: reject a body the service refuses', async () => {
    const client = getClient(createdResponse);

    const request: AnyRequest = { parameters: { itemId: ITEM_ID }, body: { itemName: 'a', itemNote: null } };

    // The service answers 400 when an optional field comes as `null`.
    await rejects(() => client.createItem(request), HttpBadRequestError);
  });

  it('assert :: reject path parameters the service refuses', async () => {
    const client = getClient(createdResponse);

    await rejects(() => client.createItem({ parameters: { itemId: 'not-a-uuid' }, body: { itemName: 'a' } }), HttpBadRequestError);
  });

  it('assert :: reject query strings the service refuses', async () => {
    const client = getClient(createdResponse);

    const request: AnyRequest = { parameters: { itemId: ITEM_ID }, query: { dryRun: 'maybe' }, body: { itemName: 'a' } };

    await rejects(() => client.createItem(request), HttpBadRequestError);
  });

  it('assert :: return the response the way the client receives it', async () => {
    const client = getClient(createdResponse);

    const response = await client.createItem({ parameters: { itemId: ITEM_ID }, query: { dryRun: true }, body: { itemName: 'a' } });

    deepEqual(response.body, {
      itemId: ITEM_ID,
      createdAt: '2026-09-29T00:00:00.000Z'
    });
  });

  it('assert :: error context reaches the caller', async () => {
    const client = getClient({
      status: 409,
      body: {
        message: 'Conflict',
        context: {
          error_code: 'ERROR_CODE_CONFLICT'
        }
      }
    });

    await rejects(
      () => client.createItem({ parameters: { itemId: ITEM_ID }, body: { itemName: 'a' } }),
      (error: unknown) => {
        ok(error instanceof HttpConflictError);
        deepEqual(error.context, { error_code: 'ERROR_CODE_CONFLICT' });
        return true;
      }
    );
  });

  it('assert :: drop a body the response contract lacks', async () => {
    const client = getClient({
      status: 200,
      body: {
        deleted: true
      }
    });

    const response: HttpClientResponse = await client.deleteItem({ parameters: { itemId: ITEM_ID } });

    equal(response.body, undefined);
  });

  it('assert :: reject an operation the service lacks', () => {
    const client = getClient(createdResponse) as unknown as Record<string, unknown>;

    throws(() => client.archiveItem);
  });

  it('assert :: tester mock survives restoreAll from another spec', async () => {
    const client = HttpTester.getClientMock<ContractApi>('anyApi', {
      default: {
        status: 204
      }
    });

    await client.createItem({ parameters: { itemId: ITEM_ID }, body: { itemName: 'a' } });

    mock.restoreAll();

    await client.createItem({ parameters: { itemId: ITEM_ID }, body: { itemName: 'b' } });

    equal(client.createItem.mock.callCount(), 2);
  });
});
