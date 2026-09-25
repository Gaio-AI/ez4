import type { EntryState } from '@ez4/state';
import type { AuthorizerFunctionParameters } from './types';

import { join } from 'node:path';

import { getDefinitionsObject } from '@ez4/project/library';
import { getFunctionBundle } from '@ez4/aws-common';
import { pickObject } from '@ez4/utils';

import { AuthorizerServiceName } from '../types';

// __MODULE_PATH is defined by the package bundler.
declare const __MODULE_PATH: string;

// Shared with the source hash, so a change to the template reaches every function it wraps.
export const getAuthorizerTemplateFile = () => {
  return join(__MODULE_PATH, '../lib/authorizer.ts');
};

export const bundleApiFunction = async (parameters: AuthorizerFunctionParameters, connections: EntryState[]) => {
  const {
    authorizer,
    listener,
    functionName,
    headersSchema,
    parametersSchema,
    querySchema,
    preferences,
    scope,
    context,
    references,
    debug
  } = parameters;

  const definitions = getDefinitionsObject(connections);

  return getFunctionBundle(AuthorizerServiceName, {
    context: context && references ? pickObject(context, references) : context,
    templateFile: getAuthorizerTemplateFile(),
    resourceName: functionName,
    filePrefix: 'auth',
    handler: authorizer,
    define: {
      ...definitions,
      __EZ4_HEADERS_SCHEMA: headersSchema ? JSON.stringify(headersSchema) : 'undefined',
      __EZ4_PARAMETERS_SCHEMA: parametersSchema ? JSON.stringify(parametersSchema) : 'undefined',
      __EZ4_QUERY_SCHEMA: querySchema ? JSON.stringify(querySchema) : 'undefined',
      __EZ4_PREFERENCES: preferences ? JSON.stringify(preferences) : 'undefined',
      __EZ4_SCOPE: scope ? JSON.stringify(scope) : 'undefined'
    },
    listener,
    debug
  });
};
