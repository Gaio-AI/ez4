import type { HttpHandler, HttpService } from '@ez4/gateway/library';

import { createSchemaOutputContext } from '../utils/reference';
import { getAnySchemaOutput } from '../schema/any';

export const getResponseSchemaName = (handler: HttpHandler) => {
  return handler.name;
};

export const getResponseSchemas = (service: HttpService) => {
  const output: Record<string, string[]> = {};

  const defaultPreferences = service.defaults?.preferences;

  for (const route of service.routes) {
    const { preferences, handler } = route;
    const { response } = handler;

    const schemaName = getResponseSchemaName(handler);

    if (!response.body || output[schemaName]) {
      continue;
    }

    const namingStyle = preferences?.namingStyle ?? defaultPreferences?.namingStyle;

    output[schemaName] = getAnySchemaOutput(response.body, namingStyle, createSchemaOutputContext(schemaName));
  }

  return output;
};
