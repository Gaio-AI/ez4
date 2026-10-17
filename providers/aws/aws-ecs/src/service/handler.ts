import type { StepContext, StepHandler } from '@ez4/state';
import type { EcsServiceResult, EcsServiceState } from './types';
import { allowForcedDeletion, CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';
import { upsertEcsService, deleteEcsService } from './client';
import { EcsServiceServiceName } from './types';

// A service keeps its identity across task definition changes: a new hash rolls it out through update.
const equalsResource = (candidate: EcsServiceState, current: EcsServiceState) =>
  !!current.result &&
  candidate.parameters.serviceName === current.parameters.serviceName &&
  candidate.parameters.clusterName === current.parameters.clusterName;

const previewResource = (candidate: EcsServiceState, current: EcsServiceState) => {
  const target = {
    ...candidate.parameters,
    getTaskDefinition: undefined,
    getServiceRegistryArn: undefined,
    dependencies: candidate.dependencies
  };
  const source = {
    ...current.parameters,
    getTaskDefinition: undefined,
    getServiceRegistryArn: undefined,
    dependencies: current.dependencies
  };
  const changes = deepCompare(target, source);
  if (!changes.counts) return undefined;
  return { ...changes, name: candidate.parameters.serviceName };
};

const deploy = (candidate: EcsServiceState, context: StepContext): Promise<EcsServiceResult> => {
  const { parameters } = candidate;
  const taskDefinition = parameters.getTaskDefinition(context);
  const registryArn = parameters.getServiceRegistryArn(context);
  return OperationLogger.logExecution(EcsServiceServiceName, parameters.serviceName, 'creation', (logger) =>
    upsertEcsService(logger, parameters, taskDefinition, registryArn)
  );
};

export const getEcsServiceHandler = (): StepHandler<EcsServiceState> => ({
  equals: equalsResource,
  preview: previewResource,
  create: deploy,
  replace: async (candidate, current, context) => {
    if (current.result) throw new ReplaceResourceError(EcsServiceServiceName, candidate.entryId, current.entryId);
    return deploy(candidate, context);
  },
  update: async (candidate, current, context) => {
    if (!candidate.result) throw new CorruptedResourceError(EcsServiceServiceName, candidate.parameters.serviceName);
    if (candidate.parameters.hash !== current.parameters.hash || candidate.dependencies.join(',') !== current.dependencies.join(',')) {
      return deploy(candidate, context);
    }
    return undefined;
  },
  delete: async (current, context) => {
    if (current.result && allowForcedDeletion(context, 'ECS service', current.parameters.serviceName)) {
      return OperationLogger.logExecution(EcsServiceServiceName, current.parameters.serviceName, 'deletion', (logger) =>
        deleteEcsService(logger, current.parameters)
      );
    }
  }
});
