import type { Environment, Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';

// Services `ez4 test` loads for this package (see ez4.project.js), so the testers reach them as a project would.

declare global {
  // Authorization header of each request the authorizer ran for.
  var authorizedHeaders: string[] | undefined;
}

export declare class ItemIdentity implements Http.Identity {
  userId: string;
  role: string;
}

export declare class ItemsProvider implements Http.Provider {
  variables: {
    ITEMS_REGION: 'local';
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

export declare class CreateItemRequest implements Http.Request {
  parameters: {
    itemId: string;
  };

  body: {
    name: string;
    note?: string;
  };
}

declare class CreateItemResponse implements Http.Response {
  status: 201;

  body: {
    itemId: string;
    name: string;
    region: string;
  };
}

declare class ReadItemRequest implements Http.Request {
  identity: ItemIdentity;

  parameters: {
    itemId: string;
  };
}

declare class ReadItemResponse implements Http.Response {
  status: 200;

  body: {
    itemId: string;
    userId: string;
    role: string;
  };
}

declare class AuthorizeRequest implements Http.AuthRequest {
  headers: {
    authorization: string;
  };
}

declare class AuthorizeResponse implements Http.AuthResponse {
  identity?: ItemIdentity;
}

export declare class ItemsApi extends Http.Service {
  routes: [
    Http.UseRoute<{
      name: 'createItem';
      path: 'POST /items/{itemId}';
      handler: typeof createItem;
    }>,
    Http.UseRoute<{
      name: 'readItem';
      path: 'GET /items/{itemId}';
      authorizer: typeof authorizeItems;
      handler: typeof readItem;
    }>
  ];
}

export function createItem(request: Http.Incoming<CreateItemRequest>, context: Service.Context<ItemsProvider>): CreateItemResponse {
  const { itemId } = request.parameters;
  const { name } = request.body;

  return {
    status: 201,
    body: {
      itemId,
      name,
      region: context.variables.ITEMS_REGION
    }
  };
}

export function readItem(request: Http.Incoming<ReadItemRequest>): ReadItemResponse {
  const { parameters, identity } = request;

  return {
    status: 200,
    body: {
      itemId: parameters.itemId,
      userId: identity.userId,
      role: identity.role
    }
  };
}

export function authorizeItems(request: Http.AuthIncoming<AuthorizeRequest>): AuthorizeResponse {
  const { authorization } = request.headers;

  globalThis.authorizedHeaders?.push(authorization);

  if (authorization !== 'Bearer admin') {
    return {};
  }

  return {
    identity: {
      userId: 'from-authorizer',
      role: 'admin'
    }
  };
}
