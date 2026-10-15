import type { StepContext, StepHandler } from '@ez4/state';
import type { EcsTaskDefResult, EcsTaskDefState } from './types';
import { CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';
import { registerTaskDefinition, deregisterTaskDefinition, describeTaskDefinition } from './client';
import { EcsTaskDefServiceName } from './types';

const equalsResource = (candidate: EcsTaskDefState, current: EcsTaskDefState) =>
  !!current.result && candidate.parameters.hash === current.parameters.hash;

const previewResource = (candidate: EcsTaskDefState, current: EcsTaskDefState) => {
  const target = { ...candidate.parameters, getTaskDefinition: undefined, dependencies: candidate.dependencies };
  const source = { ...current.parameters, getTaskDefinition: undefined, dependencies: current.dependencies };
  const changes = deepCompare(target, source);
  if (!changes.counts) return undefined;
  return { ...changes, name: candidate.parameters.family };
};

const registerDefinition = (candidate: EcsTaskDefState, context: StepContext): Promise<EcsTaskDefResult> => {
  const { parameters } = candidate;
  const taskDefinition = parameters.getTaskDefinition(context);
  return OperationLogger.logExecution(EcsTaskDefServiceName, parameters.family, 'creation', async (logger) => {
    const result = await registerTaskDefinition(logger, { family: parameters.family, taskDefinition, tags: parameters.tags });
    return { ...result, subnetIds: parameters.subnetIds, securityGroupIds: parameters.securityGroupIds };
  });
};

export const getEcsTaskDefHandler = (): StepHandler<EcsTaskDefState> => ({
  equals: equalsResource,
  preview: previewResource,
  create: registerDefinition,
  replace: async (candidate, current, context) => {
    if (current.result) throw new ReplaceResourceError(EcsTaskDefServiceName, candidate.entryId, current.entryId);
    return registerDefinition(candidate, context);
  },
  update: async (candidate, current, context) => {
    const { result, parameters } = candidate;
    if (!result) throw new CorruptedResourceError(EcsTaskDefServiceName, parameters.family);
    if (!equalsResource(candidate, current) || candidate.dependencies.join(',') !== current.dependencies.join(',')) {
      return registerDefinition(candidate, context);
    }
    return OperationLogger.logExecution(EcsTaskDefServiceName, parameters.family, 'updates', async (logger) => {
      const existing = await describeTaskDefinition(logger, result.taskDefinitionArn);
      if (!existing) return registerDefinition(candidate, context);
      return { ...result, subnetIds: parameters.subnetIds, securityGroupIds: parameters.securityGroupIds };
    });
  },
  delete: async (current, context) => {
    if (current.result && context.force) {
      return OperationLogger.logExecution(EcsTaskDefServiceName, current.parameters.family, 'deletion', async (logger) => {
        await deregisterTaskDefinition(logger, current.result!.taskDefinitionArn);
      });
    }
  }
});
