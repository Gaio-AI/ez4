import type { Http } from '@ez4/gateway';

import { HttpForbiddenError } from '@ez4/gateway';

declare class RoleRequest implements Http.Request {
  identity: {
    role: string;
  };
}

export function roleGuard(request: Http.Incoming<RoleRequest>, allow: string[]): void {
  if (!allow.includes(request.identity.role)) {
    throw new HttpForbiddenError(`Role ${request.identity.role} is not allowed.`);
  }
}
