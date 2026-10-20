import type { Http } from '@ez4/gateway';

declare class RoleRequest implements Http.Request {
  identity: {
    role: string;
  };
}

declare class RoleResponse implements Http.Response {
  status: 200;

  body: {
    route: string;
    role: string;
  };
}

export function listItems(request: Http.Incoming<RoleRequest>): RoleResponse {
  return {
    status: 200,
    body: {
      route: 'items',
      role: request.identity.role
    }
  };
}

export function listTags(request: Http.Incoming<RoleRequest>): RoleResponse {
  return {
    status: 200,
    body: {
      route: 'tags',
      role: request.identity.role
    }
  };
}
