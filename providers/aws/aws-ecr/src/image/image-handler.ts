import type { StepContext, StepHandler } from '@ez4/state';
import type { EcrRepositoryState } from '../repository/types';
import type { EcrImageResult, EcrImageState } from './state';

import { CorruptedResourceError, IncompleteResourceError, OperationLogger } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';

import { buildAndPushImage } from './build';
import { checkImageExists } from '../repository/client';
import { EcrRepositoryServiceType } from '../repository/types';
import { EcrImageServiceName } from './state';

export const getEcrImageHandler = (): StepHandler<EcrImageState> => ({
  equals: equalsResource,
  create: createResource,
  // A new tag is a new push; the previous image goes with the repository lifecycle.
  replace: (candidate, _current, context) => createResource(candidate, context),
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: EcrImageState, current: EcrImageState) => {
  return candidate.parameters.imageTag === current.parameters.imageTag;
};

const previewResource = (candidate: EcrImageState, current: EcrImageState) => {
  const { imageName, dockerfile, bundleHash, imageTag } = candidate.parameters;
  const target = { imageName, dockerfile, bundleHash, imageTag };
  const source = {
    imageName: current.parameters.imageName,
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
    name: target.imageName
  };
};

const createResource = (candidate: EcrImageState, context: StepContext): Promise<EcrImageResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(EcrImageServiceName, parameters.imageName, 'creation', async () => {
    const repository = context.getDependencies<EcrRepositoryState>(EcrRepositoryServiceType).at(0);
    const repositoryUri = repository?.result?.repositoryUri;

    if (!repositoryUri) {
      throw new IncompleteResourceError(EcrImageServiceName, candidate.entryId, 'repositoryUri');
    }

    const repositoryName = repositoryUri.split('/').slice(1).join('/');

    if (!(await checkImageExists(repositoryName, parameters.imageTag))) {
      await buildAndPushImage({
        imageName: parameters.imageName,
        repositoryUri,
        dockerfile: parameters.dockerfile,
        bundleHash: parameters.bundleHash,
        bundleFile: parameters.bundleFile
      });
    }

    return {
      imageUri: `${repositoryUri}:${parameters.imageTag}`
    };
  });
};

const updateResource = async (candidate: EcrImageState, _current: EcrImageState, context: StepContext): Promise<EcrImageResult | void> => {
  const { result, parameters } = candidate;
  const { imageName } = parameters;

  return OperationLogger.logExecution(EcrImageServiceName, imageName, 'updates', async () => {
    if (!result) {
      throw new CorruptedResourceError(EcrImageServiceName, imageName);
    }

    const repository = context.getDependencies<EcrRepositoryState>(EcrRepositoryServiceType).at(0);
    const repositoryUri = repository?.result?.repositoryUri;

    if (!repositoryUri) {
      throw new IncompleteResourceError(EcrImageServiceName, candidate.entryId, 'repositoryUri');
    }

    const repositoryName = repositoryUri.split('/').slice(1).join('/');

    if (!(await checkImageExists(repositoryName, parameters.imageTag))) {
      await buildAndPushImage({
        imageName: parameters.imageName,
        repositoryUri,
        dockerfile: parameters.dockerfile,
        bundleHash: parameters.bundleHash,
        bundleFile: parameters.bundleFile
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
