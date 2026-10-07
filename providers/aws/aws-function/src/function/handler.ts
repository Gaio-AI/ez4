import type { Arn, OperationLogLine } from '@ez4/aws-common';
import type { StepContext, StepHandler } from '@ez4/state';
import type { LinkedVariables } from '@ez4/project/library';
import type { FunctionState, FunctionResult, FunctionParameters, FunctionVpcConfig } from './types';

import { applyTagUpdates, CorruptedResourceError, getBundleHash, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare, deepEqual, hashFile } from '@ez4/utils';
import { getLogGroupName } from '@ez4/aws-logs';
import { getRoleArn } from '@ez4/aws-identity';

import {
  importFunction,
  createFunction,
  deleteFunction,
  updateConfiguration,
  updateSourceCode,
  publishFunction,
  unpublishFunctions,
  updateAlias,
  updateRetryAttempts,
  untagFunction,
  tagFunction
} from './client';

import { getInstalledPackagesHash, getPackagesResult } from './helpers/packages';
import { protectVariables } from './helpers/variables';
import { getFunctionVpcConfig } from './utils';
import { FunctionServiceName } from './types';

type FunctionConfigurationWithVariables = FunctionParameters & {
  variables: LinkedVariables;
  vpcConfig?: FunctionVpcConfig;
};

// The subnets and security groups are resolved from the network on each deploy, so the state keeps the ones
// in use: a change in the network then shows in the plan and reaches the function.
const getVpcConfig = (parameters: FunctionParameters) => {
  return parameters.vpc ? getFunctionVpcConfig() : undefined;
};

export const getFunctionHandler = (): StepHandler<FunctionState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: FunctionState, current: FunctionState) => {
  return !!candidate.result && candidate.result.functionArn === current.result?.functionArn;
};

const previewResource = async (candidate: FunctionState, current: FunctionState) => {
  const target = candidate.parameters;
  const source = current.parameters;

  const changes = deepCompare(
    {
      ...target,
      rollout: true,
      connections: candidate.connections,
      dependencies: candidate.dependencies,
      variables: protectVariables(await target.getFunctionVariables()),
      filesHash: target.files && (await getBundleHash(target.functionName, target.files)),
      sourceHash: await getBundleHash(...target.getFunctionFiles()),
      packagesHash: await getInstalledPackagesHash(current.result?.bundledPackages),
      valuesHash: await target.getFunctionHash(),
      vpcConfig: await getVpcConfig(target)
    },
    {
      ...source,
      rollout: !current.partial,
      connections: current.connections,
      dependencies: current.dependencies,
      variables: current.result?.variables,
      sourceHash: current.result?.sourceHash,
      packagesHash: current.result?.packagesHash,
      valuesHash: current.result?.valuesHash,
      filesHash: current.result?.filesHash,
      vpcConfig: current.result?.vpcConfig
    },
    {
      exclude: {
        release: true
      }
    }
  );

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.functionName
  };
};

const replaceResource = async (candidate: FunctionState, current: FunctionState, context: StepContext) => {
  if (current.result) {
    throw new ReplaceResourceError(FunctionServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate, context);
};

const createResource = (candidate: FunctionState, context: StepContext): Promise<FunctionResult> => {
  const { functionName, release, ...parameters } = candidate.parameters;

  return OperationLogger.logExecution(FunctionServiceName, functionName, 'creation', async (logger) => {
    const logGroup = getLogGroupName(FunctionServiceName, functionName, context);
    const roleArn = getRoleArn(FunctionServiceName, functionName, context);

    const [sourceHash, filesHash, sourceFile, valuesHash, variables, vpcConfig] = await Promise.all([
      getBundleHash(...parameters.getFunctionFiles()),
      parameters.files && getBundleHash(functionName, parameters.files),
      parameters.getFunctionBundle(context),
      parameters.getFunctionHash(),
      parameters.getFunctionVariables(),
      getVpcConfig(candidate.parameters)
    ]);

    const importedFunction = await importFunction(logger, functionName);
    const bundleHash = await hashFile(sourceFile);

    const { bundledPackages, packagesHash } = getPackagesResult(sourceFile);

    if (importedFunction) {
      await updateSourceCode(logger, functionName, {
        architecture: parameters.architecture,
        files: parameters.files,
        sourceFile
      });

      await updateConfiguration(logger, functionName, {
        ...parameters,
        logGroup,
        roleArn,
        vpcConfig,
        variables: {
          ...variables,
          ...(release?.variableName && {
            [release.variableName]: release.version
          })
        }
      });

      await tagFunction(logger, importedFunction.functionArn, {
        ...parameters.tags,
        ...(release?.tagName && {
          [release.tagName]: release.version
        })
      });

      const functionVersion = await publishFunction(logger, functionName);

      await updateAlias(logger, functionName, functionVersion);

      if (parameters.retryAttempts !== undefined) {
        await updateRetryAttempts(logger, functionName, parameters.retryAttempts);
      }

      return {
        variables: protectVariables(variables),
        functionArn: importedFunction.functionArn,
        functionVersion,
        sourceHash,
        valuesHash,
        bundleHash,
        filesHash,
        bundledPackages,
        packagesHash,
        logGroup,
        roleArn,
        vpcConfig
      };
    }

    const { functionArn, functionVersion } = await createFunction(logger, {
      ...parameters,
      functionName,
      sourceFile,
      logGroup,
      roleArn,
      vpcConfig,
      variables: {
        ...variables,
        ...(release?.variableName && {
          [release.variableName]: release.version
        })
      },
      tags: {
        ...parameters.tags,
        ...(release?.tagName && {
          [release.tagName]: release.version
        })
      }
    });

    await updateAlias(logger, functionName, functionVersion);

    if (parameters.retryAttempts !== undefined) {
      await updateRetryAttempts(logger, functionName, parameters.retryAttempts);
    }

    return {
      variables: protectVariables(variables),
      functionVersion,
      functionArn,
      sourceHash,
      valuesHash,
      bundleHash,
      filesHash,
      bundledPackages,
      packagesHash,
      logGroup,
      roleArn,
      vpcConfig
    };
  });
};

const updateResource = (candidate: FunctionState, current: FunctionState, context: StepContext): Promise<FunctionResult> => {
  const { parameters, result } = candidate;
  const { functionName } = parameters;

  return OperationLogger.logExecution(FunctionServiceName, functionName, 'updates', async (logger) => {
    if (!result) {
      throw new CorruptedResourceError(FunctionServiceName, functionName);
    }

    const newVariables = await parameters.getFunctionVariables();
    const oldVariables = current.result?.variables ?? newVariables;

    const newRoleArn = getRoleArn(FunctionServiceName, functionName, context);
    const oldRoleArn = current.result?.roleArn ?? newRoleArn;

    const newLogGroup = getLogGroupName(FunctionServiceName, functionName, context);
    const oldLogGroup = current.result?.logGroup ?? newLogGroup;

    const newVpcConfig = await getVpcConfig(parameters);
    const oldVpcConfig = current.result?.vpcConfig;

    const { hasSourceUpdated, ...newResult } = await checkSourceCodeUpdates(logger, functionName, parameters, current.result, context);

    const newConfig = { ...parameters, variables: newVariables, roleArn: newRoleArn, logGroup: newLogGroup, vpcConfig: newVpcConfig };
    const oldConfig = {
      ...current.parameters,
      variables: oldVariables,
      roleArn: oldRoleArn,
      logGroup: oldLogGroup,
      vpcConfig: oldVpcConfig
    };

    const hasConfigurationUpdated = await checkConfigurationUpdates(logger, functionName, newConfig, oldConfig, hasSourceUpdated, context);

    await checkTagUpdates(logger, result.functionArn, parameters, current.parameters, hasSourceUpdated);

    await checkRetryUpdates(logger, functionName, parameters, current, context);

    const shouldPublish = hasSourceUpdated || hasConfigurationUpdated;
    const functionVersion = shouldPublish ? await publishFunction(logger, functionName) : result.functionVersion;

    if (shouldPublish || current.partial || context.force) {
      context.postAction(() =>
        OperationLogger.logExecution(FunctionServiceName, functionName, 'rollout', async (logger) => {
          await updateAlias(logger, functionName, functionVersion);

          context.postAction(() =>
            OperationLogger.logExecution(FunctionServiceName, functionName, 'cleanup', async (logger) => {
              await unpublishFunctions(logger, functionName, functionVersion);
            })
          );
        })
      );
    }

    return {
      ...result,
      ...newResult,
      variables: protectVariables(newVariables),
      logGroup: newLogGroup,
      roleArn: newRoleArn,
      vpcConfig: newVpcConfig,
      functionVersion
    };
  });
};

const deleteResource = async (current: FunctionState) => {
  const { result, parameters } = current;
  const { functionName } = parameters;

  if (result) {
    return OperationLogger.logExecution(FunctionServiceName, functionName, 'deletion', async (logger) => {
      await deleteFunction(logger, functionName);
    });
  }
};

const checkConfigurationUpdates = async (
  logger: OperationLogLine,
  functionName: string,
  candidate: FunctionConfigurationWithVariables,
  current: FunctionConfigurationWithVariables,
  hasSourceUpdated: boolean,
  context: StepContext
) => {
  const { variables, ...configuration } = candidate;

  const protectedCandidate = {
    variables: protectVariables(variables),
    ...configuration
  };

  const hasConfigurationChanges = !deepEqual(protectedCandidate, current, {
    exclude: {
      sourceFile: true,
      functionName: true,
      architecture: true,
      retryAttempts: true,
      release: true,
      tags: true
    }
  });

  const candidateRelease = hasSourceUpdated ? candidate.release : current.release;
  const hasReleaseChange = hasSourceUpdated && candidateRelease?.variableName;

  if (!hasConfigurationChanges && !hasReleaseChange && !context.force) {
    return false;
  }

  await updateConfiguration(logger, functionName, {
    ...candidate,
    variables: {
      ...candidate.variables,
      ...(candidateRelease?.variableName && {
        [candidateRelease.variableName]: candidateRelease.version
      })
    }
  });

  return true;
};

const checkTagUpdates = async (
  logger: OperationLogLine,
  functionArn: Arn,
  candidate: FunctionParameters,
  current: FunctionParameters,
  hasSourceUpdated: boolean
) => {
  const hasReleaseChange = hasSourceUpdated && candidate.release?.version !== current.release?.version;
  const candidateRelease = hasReleaseChange ? candidate.release : undefined;

  const candidateTags = {
    ...candidate.tags,
    ...(candidateRelease?.tagName && {
      [candidateRelease.tagName]: candidateRelease.version
    })
  };

  await applyTagUpdates(
    candidateTags,
    current.tags,
    (tags) => tagFunction(logger, functionArn, tags),
    (tags) => untagFunction(logger, functionArn, tags)
  );
};

const checkRetryUpdates = async (
  logger: OperationLogLine,
  functionName: string,
  candidate: FunctionParameters,
  current: FunctionState,
  context: StepContext
) => {
  const { retryAttempts } = candidate;

  // A function that never sets its retries doesn't call the API, so deploying it needs no
  // permission over the asynchronous invocation config.
  const hasRetryChange = retryAttempts !== current.parameters.retryAttempts;
  const hasRetryToRestore = retryAttempts !== undefined && (current.partial || context.force);

  if (hasRetryChange || hasRetryToRestore) {
    await updateRetryAttempts(logger, functionName, retryAttempts);
  }
};

const checkSourceCodeUpdates = async (
  logger: OperationLogLine,
  functionName: string,
  candidate: FunctionParameters,
  current: FunctionResult | undefined,
  context: StepContext
) => {
  const [newSourceHash, newFilesHash, newValuesHash, newPackagesHash] = await Promise.all([
    getBundleHash(...candidate.getFunctionFiles()),
    candidate.files && getBundleHash(functionName, candidate.files),
    candidate.getFunctionHash(),
    getInstalledPackagesHash(current?.bundledPackages)
  ]);

  const oldSourceHash = current?.sourceHash;
  const oldValuesHash = current?.valuesHash;
  const oldFilesHash = current?.filesHash;
  const oldPackagesHash = current?.packagesHash;

  if (
    newSourceHash !== oldSourceHash ||
    newValuesHash !== oldValuesHash ||
    newFilesHash !== oldFilesHash ||
    newPackagesHash !== oldPackagesHash ||
    context.force
  ) {
    const newSourceFile = await candidate.getFunctionBundle(context);

    const newBundleHash = await hashFile(newSourceFile);
    const oldBundleHash = current?.bundleHash;

    // Recorded from the bundle just built even when it isn't uploaded: identical bytes are the
    // same code, whatever versions it came from.
    const { bundledPackages, packagesHash } = getPackagesResult(newSourceFile);

    if (newBundleHash === oldBundleHash && newFilesHash === oldFilesHash && newValuesHash === oldValuesHash) {
      logger.update(`Skipping source code update`);

      return {
        hasSourceUpdated: false,
        sourceHash: newSourceHash,
        bundledPackages,
        packagesHash
      };
    }

    await updateSourceCode(logger, functionName, {
      architecture: candidate.architecture,
      sourceFile: newSourceFile,
      files: candidate.files
    });

    return {
      hasSourceUpdated: true,
      valuesHash: newValuesHash,
      sourceHash: newSourceHash,
      bundleHash: newBundleHash,
      filesHash: newFilesHash,
      bundledPackages,
      packagesHash
    };
  }

  return {
    hasSourceUpdated: false
  };
};
