import type { Http } from '@ez4/gateway';

export declare class TestApi extends Http.Service {
  name: 'Test API';

  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      authorizer: typeof keyAuthorizer;
      handler: typeof listItemsHandler;
      httpErrors: {
        404: [ItemNotFoundError];
      };
    }>,
    Http.UseRoute<{
      path: 'GET /status';
      handler: typeof readStatusHandler;
    }>
  ];
}

class ItemNotFoundError extends Error {}

declare class KeyAuthorizerRequest implements Http.AuthRequest {
  headers: {
    'x-api-key': string;
  };
}

declare class KeyAuthorizerResponse implements Http.AuthResponse {
  identity?: {
    id: string;
  };
}

function keyAuthorizer(_request: Http.AuthIncoming<KeyAuthorizerRequest>): KeyAuthorizerResponse {
  return {
    identity: undefined
  };
}

declare class ListItemsRequest implements Http.Request {
  query: {
    cursor?: string;
  };
}

declare class ListItemsResponse implements Http.Response {
  status: 200;
  body: {
    items: string[];
  };
}

/**
 * @throws 400 The cursor is not valid.
 * @throws 403 The key lacks the items scope.
 * @throws 404
 * @throws 429 Rate limit exceeded.
 * @throws 429 The account is paused.
 * @throws {ItemNotFoundError} A typed tag names no status.
 */
function listItemsHandler(_request: ListItemsRequest): ListItemsResponse {
  return {
    status: 200,
    body: {
      items: []
    }
  };
}

/**
 * @throws 503 The upstream service is unavailable.
 */
function readStatusHandler(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
