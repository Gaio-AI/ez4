import type { String } from '@ez4/schema';
import type { Http } from '@ez4/gateway';

export declare class TestApi extends Http.Service {
  name: 'Test API';

  defaults: Http.UseDefaults<{
    httpErrors: {
      404: [ItemNotFoundError];
      409: [ItemConflictError];
    };
  }>;

  routes: [
    Http.UseRoute<{
      path: 'POST /items';
      authorizer: typeof bearerAuthorizer;
      handler: typeof createItemHandler;
      httpErrors: {
        422: [InvalidItemError];
      };
    }>,
    Http.UseRoute<{
      path: 'GET /items/{itemId}';
      authorizer: typeof keysAuthorizer;
      handler: typeof readItemHandler;
      httpErrors: {
        403: [ItemNotFoundError];
      };
    }>,
    Http.UseRoute<{
      path: 'GET /tree';
      handler: typeof readTreeHandler;
    }>,
    Http.UseRoute<{
      path: 'DELETE /items';
      handler: typeof deleteItemsHandler;
    }>
  ];
}

class ItemNotFoundError extends Error {}
class ItemConflictError extends Error {}
class InvalidItemError extends Error {}

declare class BearerAuthorizerRequest implements Http.AuthRequest {
  headers: {
    authorization: string;
  };
}

declare class KeysAuthorizerRequest implements Http.AuthRequest {
  headers: {
    'x-api-key': string;
  };
  query: {
    secret: string;
  };
}

declare class AuthorizerResponse implements Http.AuthResponse {
  identity?: {
    id: string;
  };
}

function bearerAuthorizer(_request: Http.AuthIncoming<BearerAuthorizerRequest>): AuthorizerResponse {
  return {
    identity: undefined
  };
}

function keysAuthorizer(_request: Http.AuthIncoming<KeysAuthorizerRequest>): AuthorizerResponse {
  return {
    identity: undefined
  };
}

declare class CreateItemRequest implements Http.Request {
  headers: {
    'x-request-id'?: string;
  };
  body: {
    name: string;
    labels?: string[];
  };
}

declare class CreateItemResponse implements Http.Response {
  status: 201;
  body: {
    id: String.UUID;
  };
}

/**
 * @summary Create an item.
 * @description Create an item named after the "name" field.
 * @tag Items
 * @tag Writes
 */
function createItemHandler(_request: CreateItemRequest): CreateItemResponse {
  return {
    status: 201,
    body: {
      id: '00000000-0000-1000-9000-000000000000'
    }
  };
}

declare class ReadItemRequest implements Http.Request {
  parameters: {
    itemId: String.UUID;
  };
  query: {
    fields?: string;
  };
}

declare class ReadItemResponse implements Http.Response {
  status: 200;
  body: {
    id: String.UUID;
    name: string;
  };
}

/**
 * @summary Read an item.
 * @tag Items
 */
function readItemHandler(_request: ReadItemRequest): ReadItemResponse {
  return {
    status: 200,
    body: {
      id: '00000000-0000-1000-9000-000000000000',
      name: 'foo'
    }
  };
}

interface TreeNode {
  name: string;
  children: TreeNode[];
}

declare class ReadTreeResponse implements Http.Response {
  status: 200;
  body: {
    nodes: TreeNode[];
  };
}

function readTreeHandler(): ReadTreeResponse {
  return {
    status: 200,
    body: {
      nodes: []
    }
  };
}

/**
 * @summary Delete all items.
 * @deprecated
 */
function deleteItemsHandler(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
