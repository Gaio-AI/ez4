import type { StepContext, StepHandler } from '@ez4/state';
import type { RoleState } from '@ez4/aws-identity';
import type { ProxyCredentialState } from './types';
import type { AgentNamespaceState } from '../namespace/types';
import type { ProxyServiceResult, ProxyServiceState } from './ecs-types';

import {
  CorruptedResourceError,
  IncompleteResourceError,
  OperationLogger,
  ReplaceResourceError
} from '@ez4/aws-common';
import { RoleServiceType } from '@ez4/aws-identity';
import { getLogGroupName } from '@ez4/aws-logs';
import { deepCompare } from '@ez4/utils';

import { ProxyCredentialServiceType } from './types';
import { AgentNamespaceServiceType } from '../namespace/types';
import { ProxyServiceServiceName } from './ecs-types';
import { buildProxyTaskDefinitionInput } from './taskdef';
import { upsertProxyService, deleteProxyService } from './ecs-client';

export const getProxyServiceHandler = (): StepHandler<ProxyServiceState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: ProxyServiceState, current: ProxyServiceState) => {
  return !!candidate.result && candidate.result.serviceArn === current.result?.serviceArn;
};

const previewResource = (candidate: ProxyServiceState, current: ProxyServiceState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.serviceName
  };
};

const replaceResource = async (
  candidate: ProxyServiceState,
  current: ProxyServiceState,
  context: StepContext
) => {
  if (current.result) {
    throw new ReplaceResourceError(ProxyServiceServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate, context);
};

const deploy = (
  candidate: ProxyServiceState,
  context: StepContext
): Promise<ProxyServiceResult> => {
  const parameters = candidate.parameters;

  const roles = context.getDependencies<RoleState>(RoleServiceType);
  const executionRoleArn = roles.find(({ parameters: roleParams }) =>
    roleParams.roleName.endsWith('-execution-role')
  )?.result?.roleArn;

  const credentialArns = context
    .getDependencies<ProxyCredentialState>(ProxyCredentialServiceType)
    .map((entry) => entry.result?.secretArn)
    .filter((arn): arn is string => !!arn)
    .sort();

  const registryArn = context
    .getDependencies<AgentNamespaceState>(AgentNamespaceServiceType)
    .at(0)?.result?.discoveryServiceArn;

  const logGroupName = getLogGroupName(ProxyServiceServiceName, candidate.entryId, context);

  if (!executionRoleArn) {
    throw new IncompleteResourceError(ProxyServiceServiceName, candidate.entryId, 'executionRoleArn');
  }

  if (!registryArn) {
    throw new IncompleteResourceError(ProxyServiceServiceName, candidate.entryId, 'registryArn');
  }

  const taskDefinitionInput = buildProxyTaskDefinitionInput({
    baseName: parameters.baseName,
    squidConfig: parameters.squidConfig,
    credentialSecretArns: credentialArns,
    executionRoleArn,
    logGroupName,
    region: parameters.region
  });

  return OperationLogger.logExecution(
    ProxyServiceServiceName,
    parameters.serviceName,
    'creation',
    async (logger) => {
      return upsertProxyService(logger, parameters, taskDefinitionInput, registryArn);
    }
  );
};

const createResource = deploy;

const updateResource = async (
  candidate: ProxyServiceState,
  current: ProxyServiceState,
  context: StepContext
): Promise<ProxyServiceResult | void> => {
  const { result, parameters } = candidate;

  if (!result) {
    throw new CorruptedResourceError(ProxyServiceServiceName, parameters.serviceName);
  }

  const changes = deepCompare(
    { ...parameters, dependencies: candidate.dependencies },
    { ...current.parameters, dependencies: current.dependencies }
  );

  if (!changes.counts) {
    return undefined;
  }

  return deploy(candidate, context);
};

const deleteResource = async (current: ProxyServiceState, context: StepContext) => {
  const { result, parameters } = current;

  if (result && context.force) {
    return OperationLogger.logExecution(
      ProxyServiceServiceName,
      parameters.serviceName,
      'deletion',
      async (logger) => {
        await deleteProxyService(logger, parameters);
      }
    );
  }
};
