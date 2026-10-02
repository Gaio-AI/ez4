import type { HttpHandler, HttpService } from '@ez4/gateway/library';

import { createSchemaOutputContext } from '../utils/reference';
import { getAnySchemaOutput } from '../schema/any';

export const getRequestSchemaName = (handler: HttpHandler) => {
  return `${handler.name}Request`;
};

export const getRequestSchemas = (service: HttpService) => {
  const output: Record<string, string[]> = {};

  const defaultPreferences = service.defaults?.preferences;

  for (const route of service.routes) {
    const { preferences, handler } = route;
    const { request } = handler;

    const schemaName = getRequestSchemaName(handler);

    if (!request?.body || output[schemaName]) {
      continue;
    }

    const namingStyle = preferences?.namingStyle ?? defaultPreferences?.namingStyle;

    output[schemaName] = getAnySchemaOutput(request.body, namingStyle, createSchemaOutputContext(schemaName));
  }

  return output;
};
