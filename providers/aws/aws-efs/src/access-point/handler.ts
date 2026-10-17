import type { StepContext, StepHandler } from '@ez4/state';
import type { OperationLogLine } from '@ez4/aws-common';
import type { FileSystemState } from '../filesystem/types';
import type { AccessPointParameters, AccessPointResult, AccessPointState } from './types';
import type { EfsClientPort } from '../filesystem/client';
import { getEfsClient } from '../filesystem/client';

import {
  allowForcedDeletion,
  CorruptedResourceError,
  IncompleteResourceError,
  OperationLogger,
  ReplaceResourceError
} from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';
import { createAccessPointResource, deleteAccessPointResource } from './client';
import { FileSystemServiceType } from '../filesystem/types';
import { AccessPointServiceName } from './types';

export type AccessPointHandlerOptions = {
  client?: EfsClientPort;
  createResource?: (logger: OperationLogLine, fileSystemId: string, parameters: AccessPointParameters) => Promise<AccessPointResult>;
  deleteResource?: (logger: OperationLogLine, result: AccessPointResult) => Promise<void>;
};

export const getAccessPointHandler = (options?: AccessPointHandlerOptions): StepHandler<AccessPointState> => {
  const createFn =
    options?.createResource ?? ((_, fsId, params) => createAccessPointResource(options?.client ?? getEfsClient(), fsId, params));
  const deleteFn = options?.deleteResource ?? ((_, res) => deleteAccessPointResource(options?.client ?? getEfsClient(), res));

  return {
    equals: equalsResource,
    create: (candidate, context) => createResource(candidate, context, createFn),
    replace: (candidate, current, context) => replaceResource(candidate, current, context, createFn),
    preview: previewResource,
    update: updateResource,
    delete: (current, context) => deleteResource(current, context, deleteFn)
  };
};

const equalsResource = (candidate: AccessPointState, current: AccessPointState) => {
  return !!candidate.result && candidate.result.accessPointArn === current.result?.accessPointArn;
};

const previewResource = (candidate: AccessPointState, current: AccessPointState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.accessPointName
  };
};

const replaceResource = async (
  candidate: AccessPointState,
  current: AccessPointState,
  context: StepContext,
  createFn: (logger: OperationLogLine, fileSystemId: string, parameters: AccessPointParameters) => Promise<AccessPointResult>
) => {
  if (current.result) {
    throw new ReplaceResourceError(AccessPointServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate, context, createFn);
};

const createResource = (
  candidate: AccessPointState,
  context: StepContext,
  createFn: (logger: OperationLogLine, fileSystemId: string, parameters: AccessPointParameters) => Promise<AccessPointResult>
): Promise<AccessPointResult> => {
  const parameters = candidate.parameters;
  const fileSystem = context.getDependencies<FileSystemState>(FileSystemServiceType).at(0);

  if (!fileSystem?.result?.fileSystemId) {
    throw new IncompleteResourceError(AccessPointServiceName, candidate.entryId, 'fileSystemId');
  }

  const fileSystemId = fileSystem.result.fileSystemId;

  return OperationLogger.logExecution(AccessPointServiceName, parameters.accessPointName, 'creation', async (logger) => {
    const result = await createFn(logger, fileSystemId, parameters);
    candidate.result = result;
    return result;
  });
};

const updateResource = async (candidate: AccessPointState, _current: AccessPointState) => {
  const { result, parameters } = candidate;
  const { accessPointName } = parameters;

  if (!result) {
    throw new CorruptedResourceError(AccessPointServiceName, accessPointName);
  }

  return Promise.resolve();
};

const deleteResource = async (
  current: AccessPointState,
  context: StepContext,
  deleteFn: (logger: OperationLogLine, result: AccessPointResult) => Promise<void>
) => {
  const { result, parameters } = current;

  if (result && allowForcedDeletion(context, 'EFS access point', parameters.accessPointName)) {
    return OperationLogger.logExecution(AccessPointServiceName, parameters.accessPointName, 'deletion', async (logger) => {
      await deleteFn(logger, result);
    });
  }
};
