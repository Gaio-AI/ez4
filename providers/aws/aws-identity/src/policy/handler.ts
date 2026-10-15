import type { Arn, OperationLogLine } from '@ez4/aws-common';
import type { StepContext, StepHandler } from '@ez4/state';
import type { PolicyDocument } from '../types/policy';
import type { PolicyState, PolicyResult, PolicyParameters } from './types';

import { applyTagUpdates, CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare, deepEqual } from '@ez4/utils';

import { createPolicyVersion, createPolicy, deletePolicy, deletePolicyVersion, tagPolicy, untagPolicy, importPolicy } from './client';
import { PolicyServiceName } from './types';

export const getPolicyHandler = (): StepHandler<PolicyState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: PolicyState, current: PolicyState) => {
  return !!candidate.result && candidate.result.policyArn === current.result?.policyArn;
};

const previewResource = (candidate: PolicyState, current: PolicyState) => {
  const currentDocument = current.result?.resolvedDocument ?? current.parameters.policyDocument;
  const target = { ...candidate.parameters, getPolicyDocument: undefined, dependencies: candidate.dependencies };
  const source = {
    ...current.parameters,
    policyDocument: currentDocument,
    getPolicyDocument: undefined,
    dependencies: current.dependencies
  };

  const changes = deepCompare(target, source);

  if (candidate.parameters.getPolicyDocument) {
    const hasDocChange = !!changes?.update?.policyDocument;
    return {
      name: target.policyName,
      counts: (changes?.counts ?? 0) + (hasDocChange ? 0 : 1),
      update: {
        ...changes?.update,
        policyDocument: true
      }
    };
  }

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.policyName
  };
};

const replaceResource = async (candidate: PolicyState, current: PolicyState, context: StepContext) => {
  if (current.result) {
    throw new ReplaceResourceError(PolicyServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate, context);
};

const createResource = (candidate: PolicyState, context: StepContext): Promise<PolicyResult> => {
  const parameters = resolvePolicyParameters(candidate.parameters, context);

  return OperationLogger.logExecution(PolicyServiceName, parameters.policyName, 'creation', async (logger) => {
    const importedPolicy = await importPolicy(logger, parameters.policyName);

    if (importedPolicy) {
      const { policyArn, currentVersion, versionHistory } = importedPolicy;

      return {
        versionHistory,
        currentVersion,
        policyArn,
        resolvedDocument: parameters.policyDocument
      };
    }

    const response = await createPolicy(logger, parameters);

    return {
      versionHistory: [],
      currentVersion: response.currentVersion,
      policyArn: response.policyArn,
      resolvedDocument: parameters.policyDocument
    };
  });
};

const updateResource = (candidate: PolicyState, current: PolicyState, context: StepContext) => {
  const result = candidate.result ?? current.result;
  const parameters = resolvePolicyParameters(candidate.parameters, context);
  const { policyName } = parameters;

  return OperationLogger.logExecution(PolicyServiceName, policyName, 'updates', async (logger) => {
    if (!result) {
      throw new CorruptedResourceError(PolicyServiceName, policyName);
    }

    await checkTagUpdates(logger, result.policyArn, parameters, current.parameters);

    const newResult = await checkDocumentUpdates(logger, result, parameters, current.parameters);

    return {
      ...result,
      ...newResult
    };
  });
};

const deleteResource = async (current: PolicyState) => {
  const { result, parameters } = current;

  if (result) {
    return OperationLogger.logExecution(PolicyServiceName, parameters.policyName, 'deletion', async (logger) => {
      // Can only remove the policy after deleting all its versions.
      if (result.versionHistory.length) {
        await deleteVersions(logger, result.policyArn, result.versionHistory);
      }

      await deletePolicy(logger, result.policyArn);
    });
  }
};

export const resolvePolicyParameters = (parameters: PolicyParameters, context?: StepContext): PolicyParameters => {
  const { getPolicyDocument, ...request } = parameters;
  return {
    ...request,
    policyDocument: (context && getPolicyDocument?.(context)) ?? request.policyDocument
  };
};

export const hasPolicyDocumentChanges = (
  candidate: PolicyParameters,
  current: PolicyParameters,
  result?: PolicyResult
): boolean => {
  const previousDocument = result?.resolvedDocument ?? current.policyDocument;
  return !deepEqual(candidate.policyDocument, previousDocument);
};

const checkDocumentUpdates = async (
  logger: OperationLogLine,
  result: PolicyResult,
  candidate: PolicyParameters,
  current: PolicyParameters
) => {
  const hasChanges = hasPolicyDocumentChanges(candidate, current, result);

  if (hasChanges) {
    const updated = await createVersion(logger, result, candidate.policyDocument);
    return { ...updated, resolvedDocument: candidate.policyDocument };
  }

  return {
    ...result,
    resolvedDocument: candidate.policyDocument
  };
};
const checkTagUpdates = async (logger: OperationLogLine, policyArn: Arn, candidate: PolicyParameters, current: PolicyParameters) => {
  await applyTagUpdates(
    candidate.tags,
    current.tags,
    (tags) => tagPolicy(logger, policyArn, tags),
    (tags) => untagPolicy(logger, policyArn, tags)
  );
};

const createVersion = async (logger: OperationLogLine, result: PolicyResult, policyDocument: PolicyDocument) => {
  const { policyArn, currentVersion, versionHistory } = result;

  // A managed policy can have up to 5 versions (1 current + 4 history)
  // @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-versioning.html
  if (versionHistory.length === 4) {
    const oldestVersionId = versionHistory.shift();

    if (oldestVersionId) {
      await deletePolicyVersion(logger, policyArn, oldestVersionId);
    }
  }

  const response = await createPolicyVersion(logger, policyArn, policyDocument);

  return {
    ...result,
    currentVersion: response.versionId,
    versionHistory: [...versionHistory, currentVersion]
  };
};

const deleteVersions = async (logger: OperationLogLine, policyArn: Arn, versionHistory: string[]) => {
  const operations = versionHistory.map((versionId) => {
    return deletePolicyVersion(logger, policyArn, versionId);
  });

  await Promise.all(operations);
};
