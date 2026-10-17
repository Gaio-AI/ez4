import type { StepContext, StepHandler } from '@ez4/state';
import type { OperationLogLine } from '@ez4/aws-common';
import type { FileSystemState } from '../filesystem/types';
import type { MountTargetParameters, MountTargetResult, MountTargetState } from './types';
import type { EfsClientPort } from '../filesystem/client';
import { getEfsClient } from '../filesystem/client';

import { allowForcedDeletion, CorruptedResourceError, IncompleteResourceError, OperationLogger } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';
import { createMountTargetResource, deleteMountTargetResource } from './client';
import { FileSystemServiceType } from '../filesystem/types';
import { MountTargetServiceName } from './types';

export type MountTargetHandlerOptions = {
  client?: EfsClientPort;
  createResource?: (logger: OperationLogLine, fileSystemId: string, parameters: MountTargetParameters) => Promise<MountTargetResult>;
  deleteResource?: (logger: OperationLogLine, result: MountTargetResult) => Promise<void>;
};

export const getMountTargetHandler = (options?: MountTargetHandlerOptions): StepHandler<MountTargetState> => {
  const createFn =
    options?.createResource ?? ((_, fsId, params) => createMountTargetResource(options?.client ?? getEfsClient(), fsId, params));
  const deleteFn = options?.deleteResource ?? ((_, res) => deleteMountTargetResource(options?.client ?? getEfsClient(), res));

  return {
    equals: equalsResource,
    create: (candidate, context) => createResource(candidate, context, createFn),
    replace: (candidate, current, context) => replaceResource(candidate, current, context, createFn, deleteFn),
    preview: previewResource,
    update: updateResource,
    delete: (current, context) => deleteResource(current, context, deleteFn)
  };
};

const equalsResource = (candidate: MountTargetState, current: MountTargetState) => {
  return (
    !!candidate.result &&
    !!current.result &&
    candidate.result.mountTargetId === current.result.mountTargetId &&
    candidate.parameters.subnetId === current.parameters.subnetId &&
    deepCompare(candidate.parameters.securityGroupIds, current.parameters.securityGroupIds).counts === 0
  );
};

const previewResource = (candidate: MountTargetState, current: MountTargetState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.subnetId
  };
};

const replaceResource = async (
  candidate: MountTargetState,
  current: MountTargetState,
  context: StepContext,
  createFn: (logger: OperationLogLine, fileSystemId: string, parameters: MountTargetParameters) => Promise<MountTargetResult>,
  deleteFn: (logger: OperationLogLine, result: MountTargetResult) => Promise<void>
) => {
  if (current.result) {
    await deleteResource(current, context, deleteFn);
  }

  return createResource(candidate, context, createFn);
};

const createResource = (
  candidate: MountTargetState,
  context: StepContext,
  createFn: (logger: OperationLogLine, fileSystemId: string, parameters: MountTargetParameters) => Promise<MountTargetResult>
): Promise<MountTargetResult> => {
  const parameters = candidate.parameters;
  const fileSystem = context.getDependencies<FileSystemState>(FileSystemServiceType).at(0);

  if (!fileSystem?.result?.fileSystemId) {
    throw new IncompleteResourceError(MountTargetServiceName, candidate.entryId, 'fileSystemId');
  }

  const fileSystemId = fileSystem.result.fileSystemId;

  return OperationLogger.logExecution(MountTargetServiceName, parameters.subnetId, 'creation', async (logger) => {
    const result = await createFn(logger, fileSystemId, parameters);
    candidate.result = result;
    return result;
  });
};

const updateResource = async (candidate: MountTargetState, _current: MountTargetState) => {
  const { result, parameters } = candidate;
  const { subnetId } = parameters;

  if (!result) {
    throw new CorruptedResourceError(MountTargetServiceName, subnetId);
  }

  return Promise.resolve();
};

const deleteResource = async (
  current: MountTargetState,
  context: StepContext,
  deleteFn: (logger: OperationLogLine, result: MountTargetResult) => Promise<void>
) => {
  const { result, parameters } = current;

  if (result && allowForcedDeletion(context, 'EFS mount target', parameters.subnetId)) {
    return OperationLogger.logExecution(MountTargetServiceName, parameters.subnetId, 'deletion', async (logger) => {
      await deleteFn(logger, result);
    });
  }
};
