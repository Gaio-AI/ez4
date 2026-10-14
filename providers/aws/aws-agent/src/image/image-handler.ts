import type { StepContext, StepHandler } from '@ez4/state';
import type { EcrRepositoryState } from './types';
import type { EcrImageResult, EcrImageState } from './state';

import { dirname } from 'node:path';
import { CorruptedResourceError, IncompleteResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';

import { buildAndPushImage } from './build';
import { checkImageExists } from './client';
import { EcrRepositoryServiceType } from './types';
import { EcrImageServiceName } from './state';

export const getEcrImageHandler = (): StepHandler<EcrImageState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: EcrImageState, current: EcrImageState) => {
  return candidate.parameters.imageTag === current.parameters.imageTag;
};

const previewResource = (candidate: EcrImageState, current: EcrImageState) => {
  const { agentName, dockerfile, bundleHash, imageTag } = candidate.parameters;
  const target = { agentName, dockerfile, bundleHash, imageTag };
  const source = {
    agentName: current.parameters.agentName,
    dockerfile: current.parameters.dockerfile,
    bundleHash: current.parameters.bundleHash,
    imageTag: current.parameters.imageTag
  };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.agentName
  };
};

const replaceResource = async (candidate: EcrImageState, current: EcrImageState, context: StepContext) => {
  if (current.result) {
    throw new ReplaceResourceError(EcrImageServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate, context);
};

const createResource = (candidate: EcrImageState, context: StepContext): Promise<EcrImageResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(EcrImageServiceName, parameters.agentName, 'creation', async () => {
    const repository = context.getDependencies<EcrRepositoryState>(EcrRepositoryServiceType).at(0);
    const repositoryUri = repository?.result?.repositoryUri;

    if (!repositoryUri) {
      throw new IncompleteResourceError(EcrImageServiceName, candidate.entryId, 'repositoryUri');
    }

    const repositoryName = repositoryUri.split('/').slice(1).join('/');

    if (!(await checkImageExists(repositoryName, parameters.imageTag))) {
      await buildAndPushImage({
        agentName: parameters.agentName,
        repositoryUri,
        dockerfile: parameters.dockerfile,
        bundleHash: parameters.bundleHash,
        workDir: dirname(parameters.bundleFile)
      });
    }

    return {
      imageUri: `${repositoryUri}:${parameters.imageTag}`
    };
  });
};

const updateResource = async (candidate: EcrImageState, _current: EcrImageState, context: StepContext): Promise<EcrImageResult | void> => {
  const { result, parameters } = candidate;
  const { agentName } = parameters;

  return OperationLogger.logExecution(EcrImageServiceName, agentName, 'updates', async () => {
    if (!result) {
      throw new CorruptedResourceError(EcrImageServiceName, agentName);
    }

    const repository = context.getDependencies<EcrRepositoryState>(EcrRepositoryServiceType).at(0);
    const repositoryUri = repository?.result?.repositoryUri;

    if (!repositoryUri) {
      throw new IncompleteResourceError(EcrImageServiceName, candidate.entryId, 'repositoryUri');
    }

    const repositoryName = repositoryUri.split('/').slice(1).join('/');

    if (!(await checkImageExists(repositoryName, parameters.imageTag))) {
      await buildAndPushImage({
        agentName: parameters.agentName,
        repositoryUri,
        dockerfile: parameters.dockerfile,
        bundleHash: parameters.bundleHash,
        workDir: dirname(parameters.bundleFile)
      });
    }

    candidate.result = {
      imageUri: `${repositoryUri}:${parameters.imageTag}`
    };
  });
};

const deleteResource = async () => {
  // Images go with the repository lifecycle
};
