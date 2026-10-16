import type { StepContext, StepHandler } from '@ez4/state';
import type { SecretParameters, SecretResult, SecretState } from './types';
import type { OperationLogLine } from '@ez4/aws-common';

import { CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';
import { createSecretResource as defaultCreate, deleteSecretResource as defaultDelete } from './client';
import { SecretServiceName } from './types';

export type SecretHandlerOptions = {
  create?: (parameters: SecretParameters, logger?: OperationLogLine) => Promise<SecretResult>;
  remove?: (secretName: string, logger?: OperationLogLine) => Promise<void>;
};

export const getSecretHandler = (options?: SecretHandlerOptions): StepHandler<SecretState> => ({
  equals: (candidate, current) => {
    return !!candidate.result && candidate.result.secretArn === current.result?.secretArn;
  },
  preview: previewResource,
  replace: (candidate, current) => replaceResource(candidate, current, options?.create ?? defaultCreate),
  create: (candidate) => createResource(candidate, options?.create ?? defaultCreate),
  update: (candidate, current) => updateResource(candidate, current, options?.create ?? defaultCreate),
  delete: (current, context) => deleteResource(current, context, options?.remove ?? defaultDelete)
});

const previewResource = (candidate: SecretState, current: SecretState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);
  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.secretName
  };
};

const replaceResource = async (
  candidate: SecretState,
  current: SecretState,
  createFn: (parameters: SecretParameters, logger?: OperationLogLine) => Promise<SecretResult>
) => {
  if (current.result) {
    throw new ReplaceResourceError(SecretServiceName, candidate.entryId, current.entryId);
  }
  return createResource(candidate, createFn);
};

const createResource = (
  candidate: SecretState,
  createFn: (parameters: SecretParameters, logger?: OperationLogLine) => Promise<SecretResult>
): Promise<SecretResult> => {
  const parameters = candidate.parameters;
  return OperationLogger.logExecution(SecretServiceName, parameters.secretName, 'creation', async (logger) => {
    return createFn(parameters, logger);
  });
};

const updateResource = async (
  candidate: SecretState,
  _current: SecretState,
  createFn: (parameters: SecretParameters, logger?: OperationLogLine) => Promise<SecretResult>
): Promise<SecretResult | void> => {
  const parameters = candidate.parameters;
  if (!candidate.result) {
    throw new CorruptedResourceError(SecretServiceName, parameters.secretName);
  }
  return OperationLogger.logExecution(SecretServiceName, parameters.secretName, 'updates', async (logger) => {
    return createFn(parameters, logger);
  });
};

const deleteResource = async (
  current: SecretState,
  _context: StepContext,
  removeFn: (secretName: string, logger?: OperationLogLine) => Promise<void>
) => {
  const { parameters } = current;
  if (parameters.retain) {
    return;
  }
  return OperationLogger.logExecution(SecretServiceName, parameters.secretName, 'deletion', async (logger) => {
    await removeFn(parameters.secretName, logger);
  });
};
