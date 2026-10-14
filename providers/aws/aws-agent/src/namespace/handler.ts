import type { StepContext, StepHandler } from '@ez4/state';
import type { AgentNamespaceResult, AgentNamespaceState } from './types';

import { CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';

import { createAgentNamespaceResource, deleteAgentNamespaceResource } from './client';
import { AgentNamespaceServiceName } from './types';

export const getAgentNamespaceHandler = (): StepHandler<AgentNamespaceState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: AgentNamespaceState, current: AgentNamespaceState) => {
  return !!candidate.result && candidate.result.namespaceArn === current.result?.namespaceArn;
};

const previewResource = (candidate: AgentNamespaceState, current: AgentNamespaceState) => {
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

const replaceResource = async (candidate: AgentNamespaceState, current: AgentNamespaceState) => {
  if (current.result) {
    throw new ReplaceResourceError(AgentNamespaceServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate);
};

const createResource = (candidate: AgentNamespaceState): Promise<AgentNamespaceResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(AgentNamespaceServiceName, parameters.namespaceName, 'creation', async (logger) => {
    return createAgentNamespaceResource(logger, parameters);
  });
};

const updateResource = async (candidate: AgentNamespaceState, _current: AgentNamespaceState) => {
  const { result, parameters } = candidate;
  const { namespaceName } = parameters;

  if (!result) {
    throw new CorruptedResourceError(AgentNamespaceServiceName, namespaceName);
  }

  return Promise.resolve();
};

const deleteResource = async (current: AgentNamespaceState, context: StepContext) => {
  const { result, parameters } = current;

  if (result && context.force) {
    return OperationLogger.logExecution(AgentNamespaceServiceName, parameters.namespaceName, 'deletion', async (logger) => {
      await deleteAgentNamespaceResource(logger, result);
    });
  }
};
