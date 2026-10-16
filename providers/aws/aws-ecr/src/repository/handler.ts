import type { StepContext, StepHandler } from '@ez4/state';
import type { EcrRepositoryResult, EcrRepositoryState } from './types';

import { CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';

import { findRepository, createRepository, deleteRepository, setLifecyclePolicy, updateScanningConfiguration } from './client';
import { EcrRepositoryServiceName } from './types';

export const getEcrRepositoryHandler = (): StepHandler<EcrRepositoryState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: EcrRepositoryState, current: EcrRepositoryState) => {
  return !!candidate.result && candidate.result.repositoryArn === current.result?.repositoryArn;
};

const previewResource = (candidate: EcrRepositoryState, current: EcrRepositoryState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.repositoryName
  };
};

const replaceResource = async (candidate: EcrRepositoryState, current: EcrRepositoryState) => {
  if (current.result) {
    throw new ReplaceResourceError(EcrRepositoryServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate);
};

const createResource = (candidate: EcrRepositoryState): Promise<EcrRepositoryResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(EcrRepositoryServiceName, parameters.repositoryName, 'creation', async (logger) => {
    const existing = await findRepository(logger, parameters.repositoryName);

    if (existing) {
      if (parameters.lifecyclePolicyText) {
        await setLifecyclePolicy(logger, parameters.repositoryName, parameters.lifecyclePolicyText);
      }
      return existing;
    }

    return createRepository(logger, parameters);
  });
};

const updateResource = async (candidate: EcrRepositoryState, current: EcrRepositoryState) => {
  const { result, parameters } = candidate;
  const { repositoryName } = parameters;

  return OperationLogger.logExecution(EcrRepositoryServiceName, repositoryName, 'updates', async (logger) => {
    if (!result) {
      throw new CorruptedResourceError(EcrRepositoryServiceName, repositoryName);
    }

    if (parameters.scanOnPush !== current.parameters.scanOnPush && parameters.scanOnPush !== undefined) {
      await updateScanningConfiguration(logger, repositoryName, parameters.scanOnPush);
    }

    if (parameters.lifecyclePolicyText !== current.parameters.lifecyclePolicyText && parameters.lifecyclePolicyText) {
      await setLifecyclePolicy(logger, repositoryName, parameters.lifecyclePolicyText);
    }
  });
};

const deleteResource = async (current: EcrRepositoryState, context: StepContext) => {
  const { result, parameters } = current;

  if (result && context.force) {
    return OperationLogger.logExecution(EcrRepositoryServiceName, parameters.repositoryName, 'deletion', async (logger) => {
      await deleteRepository(logger, parameters.repositoryName);
    });
  }
};
