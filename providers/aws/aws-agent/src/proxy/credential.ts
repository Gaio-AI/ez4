import type { EntryState, EntryStates, StepContext, StepHandler } from '@ez4/state';
import type { ProxyCredentialParameters, ProxyCredentialResult, ProxyCredentialState } from './types';

import { CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { attachEntry } from '@ez4/state';
import { deepCompare, hashData, toKebabCase } from '@ez4/utils';

import { findProxySecret, createProxySecret, deleteProxySecret } from './client';
import { ProxyCredentialServiceName, ProxyCredentialServiceType } from './types';

export const createProxyCredentialStateId = (secretName: string) => {
  return hashData(ProxyCredentialServiceType, toKebabCase(secretName));
};

export const createProxyCredential = <E extends EntryState>(
  state: EntryStates<E>,
  parameters: ProxyCredentialParameters
): ProxyCredentialState => {
  const entryId = createProxyCredentialStateId(parameters.secretName);

  return attachEntry<E | ProxyCredentialState, ProxyCredentialState>(state, {
    type: ProxyCredentialServiceType,
    entryId,
    dependencies: [],
    parameters
  });
};

export const getProxyCredentialHandler = (): StepHandler<ProxyCredentialState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: ProxyCredentialState, current: ProxyCredentialState) => {
  return !!candidate.result && candidate.result.secretArn === current.result?.secretArn;
};

const previewResource = (candidate: ProxyCredentialState, current: ProxyCredentialState) => {
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

const replaceResource = async (candidate: ProxyCredentialState, current: ProxyCredentialState) => {
  if (current.result) {
    throw new ReplaceResourceError(ProxyCredentialServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate);
};

const createResource = (candidate: ProxyCredentialState): Promise<ProxyCredentialResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(ProxyCredentialServiceName, parameters.secretName, 'creation', async (logger) => {
    const existing = await findProxySecret(logger, parameters.secretName);

    if (existing) {
      return existing;
    }

    return createProxySecret(logger, parameters);
  });
};

const updateResource = async (candidate: ProxyCredentialState, _current: ProxyCredentialState) => {
  const { result, parameters } = candidate;
  const { secretName } = parameters;

  if (!result) {
    throw new CorruptedResourceError(ProxyCredentialServiceName, secretName);
  }

  return Promise.resolve();
};

const deleteResource = async (current: ProxyCredentialState, context: StepContext) => {
  const { result, parameters } = current;

  if (result && context.force) {
    return OperationLogger.logExecution(ProxyCredentialServiceName, parameters.secretName, 'deletion', async (logger) => {
      await deleteProxySecret(logger, parameters.secretName);
    });
  }
};
