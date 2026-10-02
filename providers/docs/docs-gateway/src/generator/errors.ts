import type { HttpRoute, HttpService } from '@ez4/gateway/library';
import type { ObjectSchema } from '@ez4/schema';

import { SchemaType } from '@ez4/schema';

import { STATUS_CODES } from 'node:http';

import { getAnySchemaOutput } from '../schema/any';

export const HttpErrorSchemaName = 'HttpError';

export const GatewayErrorSchemaName = 'GatewayError';

/**
 * Body of the errors the service returns (see `getJsonError` in `@ez4/gateway/utils`).
 */
const HttpErrorSchema: ObjectSchema = {
  type: SchemaType.Object,
  description: 'Error returned by the service.',
  properties: {
    type: {
      type: SchemaType.String,
      definitions: {
        value: 'error'
      }
    },
    message: {
      type: SchemaType.String
    },
    context: {
      type: SchemaType.Object,
      optional: true,
      definitions: {
        extensible: true
      },
      properties: {}
    }
  }
};

/**
 * Body of the errors the gateway returns when it denies the authorization, without reaching the service.
 */
const GatewayErrorSchema: ObjectSchema = {
  type: SchemaType.Object,
  description: 'Error returned by the gateway when it denies the request authorization.',
  properties: {
    message: {
      type: SchemaType.String
    }
  }
};

export const getErrorSchemas = (service: HttpService) => {
  const schemaNames = new Set<string>();

  for (const route of service.routes) {
    for (const [, errorSchemaNames] of getRouteErrors(service, route)) {
      errorSchemaNames.forEach((schemaName) => schemaNames.add(schemaName));
    }
  }

  const output: Record<string, string[]> = {};

  if (schemaNames.has(HttpErrorSchemaName)) {
    output[HttpErrorSchemaName] = getAnySchemaOutput(HttpErrorSchema);
  }

  if (schemaNames.has(GatewayErrorSchemaName)) {
    output[GatewayErrorSchemaName] = getAnySchemaOutput(GatewayErrorSchema);
  }

  return output;
};

/**
 * Get the error statuses the route can respond, sorted, with the schema names of their bodies.
 */
export const getRouteErrors = (service: HttpService, route: HttpRoute) => {
  const errors = new Map<number, Set<string>>();

  const addError = (status: number, schemaName: string) => {
    const schemaNames = errors.get(status) ?? new Set();

    errors.set(status, schemaNames.add(schemaName));
  };

  const { request } = route.handler;

  // The service validates every part of the request it declares before calling the handler.
  if (request?.headers || request?.parameters || request?.query || request?.body || request?.identity) {
    addError(400, HttpErrorSchemaName);
  }

  // Route errors take the place of the service errors with the same name.
  const httpErrors = {
    ...service.defaults?.httpErrors,
    ...route.httpErrors
  };

  for (const errorName in httpErrors) {
    addError(httpErrors[errorName], HttpErrorSchemaName);
  }

  // The gateway responds by itself with 401 when the credential is missing or the authorizer finds it
  // unauthorized, and with 403 when the authorizer denies the request.
  if (route.authorizer) {
    addError(401, GatewayErrorSchemaName);
    addError(403, GatewayErrorSchemaName);
  }

  return [...errors.entries()]
    .sort(([statusA], [statusB]) => statusA - statusB)
    .map(([status, schemaNames]): [number, string[]] => [status, [...schemaNames]]);
};

export const getErrorDescription = (status: number) => {
  return STATUS_CODES[status] ?? 'Error';
};
