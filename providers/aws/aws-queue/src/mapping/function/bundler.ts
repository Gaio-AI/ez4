import type { EntryState } from '@ez4/state';
import type { QueueFunctionParameters } from './types';

import { join } from 'node:path';

import { MappingServiceName } from '@ez4/aws-function';
import { getDefinitionsObject } from '@ez4/project/library';
import { getFunctionBundle } from '@ez4/aws-common';
import { pickObject } from '@ez4/utils';

// __MODULE_PATH is defined by the package bundler.
declare const __MODULE_PATH: string;

export type BundleQueueFunctionParameters = QueueFunctionParameters;

// Shared with the source hash, so a change to the template reaches every function it wraps.
export const getQueueTemplateFile = () => {
  return join(__MODULE_PATH, '../lib/message.ts');
};

export const bundleQueueFunction = async (parameters: BundleQueueFunctionParameters, connections: EntryState[]) => {
  const { handler, listener, functionName, messageSchema, backoff, parallelism, context, references, debug } = parameters;

  const definitions = getDefinitionsObject(connections);

  return getFunctionBundle(MappingServiceName, {
    context: context && references ? pickObject(context, references) : context,
    templateFile: getQueueTemplateFile(),
    resourceName: functionName,
    filePrefix: 'sqs',
    define: {
      ...definitions,
      __EZ4_SCHEMA: messageSchema ? JSON.stringify(messageSchema) : 'undefined',
      __EZ4_MAX_ATTEMPTS: `${backoff.attempts}`,
      __EZ4_MIN_BACKOFF: `${backoff.minDelay}`,
      __EZ4_MAX_BACKOFF: `${backoff.maxDelay}`,
      __EZ4_PARALLELISM: `${parallelism}`
    },
    handler,
    listener,
    debug
  });
};
