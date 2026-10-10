import type { Http } from '@ez4/gateway';

declare class GetItemRequest implements Http.Request {
  parameters: {
    itemId: string;
  };

  query: {
    fields?: string;
  };
}

declare class ItemResponse implements Http.Response {
  status: 200;

  body: {
    itemId: string;
    itemName: string;
  };
}

declare class CreateItemRequest implements Http.Request {
  identity: {
    userId: string;
  };

  body: {
    itemName: string;
  };
}

declare class AuthRequest implements Http.AuthRequest {
  headers: {
    authorization: string;
  };
}

declare class AuthResponse implements Http.AuthResponse {
  identity: {
    userId: string;
  };
}

export function getItem(request: Http.Incoming<GetItemRequest>): ItemResponse {
  return {
    status: 200,
    body: {
      itemId: request.parameters.itemId,
      itemName: 'item'
    }
  };
}

export function createItem(request: Http.Incoming<CreateItemRequest>): ItemResponse {
  return {
    status: 200,
    body: {
      itemId: request.identity.userId,
      itemName: request.body.itemName
    }
  };
}

export function health(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

export function itemsAuthorizer(request: AuthRequest): AuthResponse {
  return {
    identity: {
      userId: request.headers.authorization
    }
  };
}
