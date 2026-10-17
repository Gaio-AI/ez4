import type { StepContext, StepHandler } from '@ez4/state';
import type { NamespaceResult, NamespaceState, NamespaceParameters } from './types';
import type { OperationLogLine } from '@ez4/aws-common';

import { allowForcedDeletion, CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';

import { createNamespaceResource as defaultCreate, deleteNamespaceResource as defaultDelete } from './client';
import { NamespaceServiceName } from './types';

export type NamespaceHandlerOptions = {
  createResource?: (logger: OperationLogLine, parameters: NamespaceParameters) => Promise<NamespaceResult>;
  deleteResource?: (logger: OperationLogLine, result: NamespaceResult) => Promise<void>;
};

export const getNamespaceHandler = (options?: NamespaceHandlerOptions): StepHandler<NamespaceState> => ({
  equals: equalsResource,
  create: (candidate) => createResource(candidate, options?.createResource ?? defaultCreate),
  replace: (candidate, current) => replaceResource(candidate, current, options?.createResource ?? defaultCreate),
  preview: previewResource,
  update: updateResource,
  delete: (current, context) => deleteResource(current, context, options?.deleteResource ?? defaultDelete)
});

const equalsResource = (candidate: NamespaceState, current: NamespaceState) => {
  return !!candidate.result && candidate.result.namespaceArn === current.result?.namespaceArn;
};

const previewResource = (candidate: NamespaceState, current: NamespaceState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.namespaceName
  };
};

const replaceResource = async (
  candidate: NamespaceState,
  current: NamespaceState,
  createFn: (logger: OperationLogLine, parameters: NamespaceParameters) => Promise<NamespaceResult>
) => {
  if (current.result) {
    throw new ReplaceResourceError(NamespaceServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate, createFn);
};

const createResource = (
  candidate: NamespaceState,
  createFn: (logger: OperationLogLine, parameters: NamespaceParameters) => Promise<NamespaceResult>
): Promise<NamespaceResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(NamespaceServiceName, parameters.namespaceName, 'creation', async (logger) => {
    return createFn(logger, parameters);
  });
};

const updateResource = async (candidate: NamespaceState, _current: NamespaceState) => {
  const { result, parameters } = candidate;
  const { namespaceName } = parameters;

  if (!result) {
    throw new CorruptedResourceError(NamespaceServiceName, namespaceName);
  }

  return Promise.resolve();
};

const deleteResource = async (
  current: NamespaceState,
  context: StepContext,
  deleteFn: (logger: OperationLogLine, result: NamespaceResult) => Promise<void>
) => {
  const { result, parameters } = current;

  if (result && allowForcedDeletion(context, 'Cloud Map namespace', parameters.namespaceName)) {
    return OperationLogger.logExecution(NamespaceServiceName, parameters.namespaceName, 'deletion', async (logger) => {
      await deleteFn(logger, result);
    });
  }
};
