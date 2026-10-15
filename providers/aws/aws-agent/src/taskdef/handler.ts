import type { StepContext, StepHandler } from '@ez4/state';
import type { RoleState } from '@ez4/aws-identity';
import type { ProxyCredentialState } from '../proxy/types';
import type { ProviderCredentialState } from '../auth/types';
import type { EcrImageState } from '../image/state';
import type { EcsTaskDefResult, EcsTaskDefState } from './types';

import { CorruptedResourceError, IncompleteResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { RoleServiceType } from '@ez4/aws-identity';
import { getLogGroupName } from '@ez4/aws-logs';
import { deepCompare } from '@ez4/utils';

import { ProxyCredentialServiceType } from '../proxy/types';
import { EcrImageServiceType } from '../image/state';
import { ProviderCredentialServiceType } from '../auth/types';
import { registerTaskDefinition, deregisterTaskDefinition, describeTaskDefinition } from './client';
import { buildTaskDefinitionInput } from './service';
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
  if (!changes.counts) return undefined;
  return { ...changes, name: target.agentName };
};

const replaceResource = async (candidate: EcsTaskDefState, current: EcsTaskDefState, context: StepContext) => {
  if (current.result) throw new ReplaceResourceError(EcsTaskDefServiceName, candidate.entryId, current.entryId);
  return createResource(candidate, context);
};

const registerDefinition = (candidate: EcsTaskDefState, context: StepContext): Promise<EcsTaskDefResult> => {
  const parameters = candidate.parameters;
  const imageUri = context.getDependencies<EcrImageState>(EcrImageServiceType).at(0)?.result?.imageUri;
  if (!imageUri) throw new IncompleteResourceError(EcsTaskDefServiceName, candidate.entryId, 'imageUri');

  const roles = context.getDependencies<RoleState>(RoleServiceType);
  const taskRoleArn = roles.find(({ parameters }) => !parameters.roleName.endsWith('-execution-role'))?.result?.roleArn;
  const executionRoleArn = roles.find(({ parameters }) => parameters.roleName.endsWith('-execution-role'))?.result?.roleArn;
  if (!taskRoleArn) throw new IncompleteResourceError(EcsTaskDefServiceName, candidate.entryId, 'taskRoleArn');
  if (!executionRoleArn) throw new IncompleteResourceError(EcsTaskDefServiceName, candidate.entryId, 'executionRoleArn');

  const proxySecretArn = context.getDependencies<ProxyCredentialState>(ProxyCredentialServiceType).at(0)?.result?.secretArn;
  const providerSecrets: Array<{ name: string; secretArn: string }> = [];
  const providerCredentials = context.getDependencies<ProviderCredentialState>(ProviderCredentialServiceType);
  for (const cred of providerCredentials) {
    const secretArn = cred.result?.secretArn;
    if (!secretArn) {
      throw new IncompleteResourceError(EcsTaskDefServiceName, candidate.entryId, 'providerSecretArn');
    }
    providerSecrets.push({
      name: cred.parameters.envName,
      secretArn
    });
  }
  const logGroupName = getLogGroupName(EcsTaskDefServiceName, candidate.entryId, context);
  const taskDefinition = buildTaskDefinitionInput(parameters.agent, imageUri, taskRoleArn, executionRoleArn, logGroupName, {
    baseName: parameters.baseName,
    bucketName: parameters.bucketName,
    region: parameters.region,
    proxy: parameters.proxyUrl && proxySecretArn ? { url: parameters.proxyUrl, secretArn: proxySecretArn } : undefined,
    providerSecrets
  });
  return OperationLogger.logExecution(EcsTaskDefServiceName, parameters.agentName, 'creation', async (logger) => {
    const result = await registerTaskDefinition(logger, { agentName: parameters.agentName, taskDefinition, tags: parameters.tags });
    return { ...result, subnetIds: parameters.subnetIds, securityGroupIds: parameters.securityGroupIds };
  });
};

const createResource = registerDefinition;

const updateResource = async (
  candidate: EcsTaskDefState,
  current: EcsTaskDefState,
  context: StepContext
): Promise<EcsTaskDefResult | void> => {
  const { result, parameters } = candidate;
  if (!result) throw new CorruptedResourceError(EcsTaskDefServiceName, parameters.agentName);

  if (
    deepCompare({ ...parameters, dependencies: candidate.dependencies }, { ...current.parameters, dependencies: current.dependencies })
      .counts
  ) {
    return registerDefinition(candidate, context);
  }
  return OperationLogger.logExecution(EcsTaskDefServiceName, parameters.agentName, 'updates', async (logger) => {
    const existing = await describeTaskDefinition(logger, result.taskDefinitionArn);
    if (!existing) return registerDefinition(candidate, context);
    return { ...result, subnetIds: parameters.subnetIds, securityGroupIds: parameters.securityGroupIds };
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
