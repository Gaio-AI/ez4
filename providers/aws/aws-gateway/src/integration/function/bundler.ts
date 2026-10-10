import type { EntryState } from '@ez4/state';
import type { IntegrationFunctionParameters, IntegrationGroupParameters, IntegrationGroupRoute } from './types';

import { join } from 'node:path';

import { getDefinitionsObject } from '@ez4/project/library';
import { getFunctionBundle } from '@ez4/aws-common';
import { pickObject } from '@ez4/utils';

import { IntegrationServiceName } from '../types';
import { IntegrationFunctionType } from './types';

// __MODULE_PATH is defined by the package bundler.
declare const __MODULE_PATH: string;

export type BundleFunction = (parameters: IntegrationFunctionParameters, connections: EntryState[]) => Promise<string>;

const templateFiles: Record<IntegrationFunctionType, string> = {
  [IntegrationFunctionType.HttpRequest]: '../lib/request.ts',
  [IntegrationFunctionType.WsConnection]: '../lib/connection.ts',
  [IntegrationFunctionType.WsMessage]: '../lib/message.ts'
};

// Shared with the source hash, so a change to the template reaches every function it wraps.
export const getIntegrationTemplateFile = (type: IntegrationFunctionType) => {
  return join(__MODULE_PATH, templateFiles[type]);
};

export const getGroupTemplateFile = () => {
  return join(__MODULE_PATH, '../lib/group.ts');
};

/**
 * The handlers a group function imports, each once, and the position of each route's handler among them.
 */
const getGroupHandlers = (routes: IntegrationGroupRoute[]) => {
  const handlerKeys: string[] = [];

  const handlers: IntegrationGroupRoute['handler'][] = [];
  const positions: number[] = [];

  for (const { handler } of routes) {
    const handlerKey = `${handler.module ?? handler.sourceFile}:${handler.functionName}`;

    let position = handlerKeys.indexOf(handlerKey);

    if (position < 0) {
      position = handlers.push(handler) - 1;
      handlerKeys.push(handlerKey);
    }

    positions.push(position);
  }

  return { handlers, positions };
};

export const bundleGroupFunction = async (parameters: IntegrationGroupParameters, connections: EntryState[]) => {
  const { groupName, routes, listener, functionName, context, references, debug } = parameters;

  const { handlers, positions } = getGroupHandlers(routes);

  // Each route's settings go as a JSON string, which the template parses on the route's first request.
  const groupRoutes = routes.map(({ routeKey, handler: _handler, ...config }, index) => {
    return [routeKey, { handler: positions[index], config: JSON.stringify(config) }];
  });

  const definitions = getDefinitionsObject(connections);

  return getFunctionBundle(IntegrationServiceName, {
    context: context && references ? pickObject(context, references) : context,
    templateFile: getGroupTemplateFile(),
    resourceName: functionName,
    filePrefix: 'api',
    define: {
      ...definitions,
      __EZ4_ROUTES: JSON.stringify(Object.fromEntries(groupRoutes))
    },
    groupName,
    handlers,
    listener,
    debug
  });
};

export const bundleRequestFunction = async (parameters: IntegrationFunctionParameters, connections: EntryState[]) => {
  const {
    handler,
    listener,
    preferences,
    functionName,
    headersSchema,
    parametersSchema,
    querySchema,
    bodySchema,
    identitySchema,
    responseSchema,
    errorsMap,
    scope,
    context,
    references,
    debug
  } = parameters;

  const definitions = getDefinitionsObject(connections);

  return getFunctionBundle(IntegrationServiceName, {
    context: context && references ? pickObject(context, references) : context,
    templateFile: getIntegrationTemplateFile(IntegrationFunctionType.HttpRequest),
    resourceName: functionName,
    filePrefix: 'api',
    define: {
      ...definitions,
      __EZ4_HEADERS_SCHEMA: headersSchema ? JSON.stringify(headersSchema) : 'undefined',
      __EZ4_PARAMETERS_SCHEMA: parametersSchema ? JSON.stringify(parametersSchema) : 'undefined',
      __EZ4_QUERY_SCHEMA: querySchema ? JSON.stringify(querySchema) : 'undefined',
      __EZ4_IDENTITY_SCHEMA: identitySchema ? JSON.stringify(identitySchema) : 'undefined',
      __EZ4_BODY_SCHEMA: bodySchema ? JSON.stringify(bodySchema) : 'undefined',
      __EZ4_RESPONSE_SCHEMA: responseSchema ? JSON.stringify(responseSchema) : 'undefined',
      __EZ4_PREFERENCES: preferences ? JSON.stringify(preferences) : 'undefined',
      __EZ4_ERRORS_MAP: errorsMap ? JSON.stringify(errorsMap) : 'undefined',
      __EZ4_SCOPE: scope ? JSON.stringify(scope) : 'undefined'
    },
    handler,
    listener,
    debug
  });
};

export const bundleConnectionFunction = async (parameters: IntegrationFunctionParameters, connections: EntryState[]) => {
  const { handler, listener, preferences, functionName, headersSchema, querySchema, identitySchema, scope, context, references, debug } =
    parameters;

  const definitions = getDefinitionsObject(connections);

  return getFunctionBundle(IntegrationServiceName, {
    context: context && references ? pickObject(context, references) : context,
    templateFile: getIntegrationTemplateFile(IntegrationFunctionType.WsConnection),
    resourceName: functionName,
    filePrefix: 'api',
    define: {
      ...definitions,
      __EZ4_HEADERS_SCHEMA: headersSchema ? JSON.stringify(headersSchema) : 'undefined',
      __EZ4_QUERY_SCHEMA: querySchema ? JSON.stringify(querySchema) : 'undefined',
      __EZ4_IDENTITY_SCHEMA: identitySchema ? JSON.stringify(identitySchema) : 'undefined',
      __EZ4_PREFERENCES: preferences ? JSON.stringify(preferences) : 'undefined',
      __EZ4_SCOPE: scope ? JSON.stringify(scope) : 'undefined'
    },
    handler,
    listener,
    debug
  });
};

export const bundleMessageFunction = async (parameters: IntegrationFunctionParameters, connections: EntryState[]) => {
  const { handler, listener, preferences, functionName, bodySchema, identitySchema, responseSchema, context, references, debug } =
    parameters;

  const definitions = getDefinitionsObject(connections);

  return getFunctionBundle(IntegrationServiceName, {
    context: context && references ? pickObject(context, references) : context,
    templateFile: getIntegrationTemplateFile(IntegrationFunctionType.WsMessage),
    resourceName: functionName,
    filePrefix: 'api',
    define: {
      ...definitions,
      __EZ4_BODY_SCHEMA: bodySchema ? JSON.stringify(bodySchema) : 'undefined',
      __EZ4_IDENTITY_SCHEMA: identitySchema ? JSON.stringify(identitySchema) : 'undefined',
      __EZ4_RESPONSE_SCHEMA: responseSchema ? JSON.stringify(responseSchema) : 'undefined',
      __EZ4_PREFERENCES: preferences ? JSON.stringify(preferences) : 'undefined'
    },
    handler,
    listener,
    debug
  });
};
