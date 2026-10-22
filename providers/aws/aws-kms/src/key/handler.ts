import type { OperationLogLine } from '@ez4/aws-common';
import type { StepContext, StepHandler } from '@ez4/state';
import type { KeyState, KeyResult, KeyParameters } from './types';

import { allowForcedDeletion, applyTagUpdates, CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';

import { importKey, createKey, deleteKey, tagKey, untagKey, updateKeyDescription } from './client';
import { KeyServiceName } from './types';

export const getKeyHandler = (): StepHandler<KeyState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: KeyState, current: KeyState) => {
  return !!candidate.result && candidate.result.keyArn === current.result?.keyArn;
};

const previewResource = (candidate: KeyState, current: KeyState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.aliasName
  };
};

const replaceResource = async (candidate: KeyState, current: KeyState) => {
  if (current.result) {
    throw new ReplaceResourceError(KeyServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate);
};

const createResource = (candidate: KeyState): Promise<KeyResult> => {
  const { parameters } = candidate;

  return OperationLogger.logExecution(KeyServiceName, parameters.aliasName, 'creation', async (logger) => {
    return (await importKey(logger, parameters.aliasName)) ?? (await createKey(logger, parameters));
  });
};

const updateResource = async (candidate: KeyState, current: KeyState) => {
  const { result, parameters } = candidate;
  const { aliasName } = parameters;

  return OperationLogger.logExecution(KeyServiceName, aliasName, 'updates', async (logger) => {
    if (!result) {
      throw new CorruptedResourceError(KeyServiceName, aliasName);
    }

    if (parameters.description !== current.parameters.description) {
      await updateKeyDescription(logger, result.keyId, parameters.description);
    }

    await checkTagUpdates(logger, result.keyId, parameters, current.parameters);
  });
};

/**
 * Deleting a key loses everything it encrypted, so it only happens with `--force`, and even then
 * KMS keeps the key for its whole deletion window, where cancelling the deletion restores it.
 */
const deleteResource = async (current: KeyState, context: StepContext) => {
  const { result, parameters } = current;
  const { aliasName } = parameters;

  if (result && allowForcedDeletion(context, 'Key', aliasName)) {
    return OperationLogger.logExecution(KeyServiceName, aliasName, 'deletion', async (logger) => {
      await deleteKey(logger, result.keyId, aliasName);
    });
  }
};

const checkTagUpdates = async (logger: OperationLogLine, keyId: string, candidate: KeyParameters, current: KeyParameters) => {
  await applyTagUpdates(
    candidate.tags,
    current.tags,
    (tags) => tagKey(logger, keyId, tags),
    (tags) => untagKey(logger, keyId, tags)
  );
};
