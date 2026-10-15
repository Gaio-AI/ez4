import type { StepHandler } from '@ez4/state';
import type { ProviderCredentialResult, ProviderCredentialState } from './types';

import { IncompleteResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';

import { findProviderSecret } from './client';
import { ProviderCredentialServiceName } from './types';

export const getProviderCredentialHandler = (): StepHandler<ProviderCredentialState> => ({
  equals: (candidate, current) => {
    return !!candidate.result && candidate.result.secretArn === current.result?.secretArn;
  },
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const previewResource = (candidate: ProviderCredentialState, current: ProviderCredentialState) => {
  if (current.result) {
    candidate.result = { ...current.result };
  }
  return undefined;
};

const replaceResource = async (candidate: ProviderCredentialState, current: ProviderCredentialState) => {
  if (current.result) {
    throw new ReplaceResourceError(ProviderCredentialServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate);
};

const createResource = (candidate: ProviderCredentialState): Promise<ProviderCredentialResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(ProviderCredentialServiceName, parameters.secretName, 'creation', async (logger) => {
    const existing = await findProviderSecret(parameters.secretName, logger);

    if (existing) {
      return existing;
    }

    throw new IncompleteResourceError(ProviderCredentialServiceName, candidate.entryId, 'secretArn');
  });
};

const updateResource = async (
  candidate: ProviderCredentialState,
  _current: ProviderCredentialState
): Promise<ProviderCredentialResult | void> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(ProviderCredentialServiceName, parameters.secretName, 'updates', async (logger) => {
    const existing = await findProviderSecret(parameters.secretName, logger);

    if (existing) {
      return existing;
    }

    throw new IncompleteResourceError(ProviderCredentialServiceName, candidate.entryId, 'secretArn');
  });
};

const deleteResource = async (_current: ProviderCredentialState) => {
  // no-op: the secret is shared by every project of the stage and survives ez4 destroy
};
