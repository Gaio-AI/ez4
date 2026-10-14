import type { StepContext, StepHandler } from '@ez4/state';
import type { EcsTaskDefResult, EcsTaskDefState } from './types';

import { CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';

import { registerTaskDefinition, deregisterTaskDefinition, describeTaskDefinition } from './client';
import { EcsTaskDefServiceName } from './types';

export const getEcsTaskDefHandler = (): StepHandler<EcsTaskDefState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: EcsTaskDefState, current: EcsTaskDefState) => {
  return !!candidate.result && candidate.result.taskDefinitionArn === current.result?.taskDefinitionArn;
};

const previewResource = (candidate: EcsTaskDefState, current: EcsTaskDefState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.agentName
  };
};

const replaceResource = async (candidate: EcsTaskDefState, current: EcsTaskDefState) => {
  if (current.result) {
    throw new ReplaceResourceError(EcsTaskDefServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate);
};

const createResource = (candidate: EcsTaskDefState): Promise<EcsTaskDefResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(EcsTaskDefServiceName, parameters.agentName, 'creation', async (logger) => {
    return registerTaskDefinition(logger, parameters);
  });
};

const updateResource = async (candidate: EcsTaskDefState, current: EcsTaskDefState): Promise<EcsTaskDefResult | void> => {
  const { result, parameters } = candidate;
  const { agentName } = parameters;

  return OperationLogger.logExecution(EcsTaskDefServiceName, agentName, 'updates', async (logger) => {
    if (!result) {
      throw new CorruptedResourceError(EcsTaskDefServiceName, agentName);
    }

    // Check if definition changed compared to current parameters
    const changes = deepCompare(candidate.parameters, current.parameters);
    if (changes.counts) {
      const newResult = await registerTaskDefinition(logger, candidate.parameters);
      candidate.result = newResult;
      return;
    }

    const existing = await describeTaskDefinition(logger, result.taskDefinitionArn);
    if (!existing) {
      const newResult = await registerTaskDefinition(logger, candidate.parameters);
      candidate.result = newResult;
    }
  });
};

const deleteResource = async (current: EcsTaskDefState, context: StepContext) => {
  const { result, parameters } = current;

  if (result && context.force) {
    return OperationLogger.logExecution(EcsTaskDefServiceName, parameters.agentName, 'deletion', async (logger) => {
      await deregisterTaskDefinition(logger, result.taskDefinitionArn);
    });
  }
};
