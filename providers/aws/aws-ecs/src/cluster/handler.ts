import type { StepContext, StepHandler } from '@ez4/state';
import type { EcsClusterResult, EcsClusterState } from './types';

import { allowForcedDeletion, CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';

import { findCluster, createCluster, deleteCluster } from './client';
import { EcsClusterServiceName } from './types';

export const getEcsClusterHandler = (): StepHandler<EcsClusterState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: EcsClusterState, current: EcsClusterState) => {
  return !!candidate.result && candidate.result.clusterArn === current.result?.clusterArn;
};

const previewResource = (candidate: EcsClusterState, current: EcsClusterState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.clusterName
  };
};

const replaceResource = async (candidate: EcsClusterState, current: EcsClusterState) => {
  if (current.result) {
    throw new ReplaceResourceError(EcsClusterServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate);
};

const createResource = (candidate: EcsClusterState): Promise<EcsClusterResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(EcsClusterServiceName, parameters.clusterName, 'creation', async (logger) => {
    const existing = await findCluster(logger, parameters.clusterName);

    if (existing) {
      return existing;
    }

    return createCluster(logger, parameters);
  });
};

const updateResource = async (candidate: EcsClusterState, _current: EcsClusterState) => {
  const { result, parameters } = candidate;
  const { clusterName } = parameters;

  if (!result) {
    throw new CorruptedResourceError(EcsClusterServiceName, clusterName);
  }

  return Promise.resolve();
};

const deleteResource = async (current: EcsClusterState, context: StepContext) => {
  const { result, parameters } = current;

  if (result && allowForcedDeletion(context, 'ECS cluster', parameters.clusterName)) {
    return OperationLogger.logExecution(EcsClusterServiceName, parameters.clusterName, 'deletion', async (logger) => {
      await deleteCluster(logger, parameters.clusterName);
    });
  }
};
