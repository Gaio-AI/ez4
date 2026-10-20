import { HttpForbiddenError } from '@ez4/gateway';

type RoleRequest = {
  headers: {
    'x-role': string;
  };
};

export const roleGuard = (request: RoleRequest, allow: string[], context: unknown) => {
  const role = request.headers['x-role'];

  if (!allow.includes(role) || !context) {
    throw new HttpForbiddenError(`Role ${role} is not allowed.`);
  }
};

export const listItems = (request: RoleRequest) => {
  return {
    status: 204,
    headers: {
      'x-role': request.headers['x-role']
    }
  };
};
