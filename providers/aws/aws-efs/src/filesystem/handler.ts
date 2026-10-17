import type { StepContext, StepHandler } from '@ez4/state';
import type { OperationLogLine } from '@ez4/aws-common';
import type { FileSystemParameters, FileSystemResult, FileSystemState } from './types';
import type { EfsClientPort } from './client';

import { allowForcedDeletion, CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';
import { createFileSystemResource, deleteFileSystemResource, getEfsClient } from './client';
import { FileSystemServiceName } from './types';

export type FileSystemHandlerOptions = {
  client?: EfsClientPort;
  createResource?: (logger: OperationLogLine, parameters: FileSystemParameters) => Promise<FileSystemResult>;
  deleteResource?: (logger: OperationLogLine, result: FileSystemResult) => Promise<void>;
};

export const getFileSystemHandler = (options?: FileSystemHandlerOptions): StepHandler<FileSystemState> => {
  const createFn = options?.createResource ?? ((_, params) => createFileSystemResource(options?.client ?? getEfsClient(), params));
  const deleteFn = options?.deleteResource ?? ((_, res) => deleteFileSystemResource(options?.client ?? getEfsClient(), res));

  return {
    equals: equalsResource,
    create: (candidate) => createResource(candidate, createFn),
    replace: (candidate, current) => replaceResource(candidate, current, createFn),
    preview: previewResource,
    update: updateResource,
    delete: (current, context) => deleteResource(current, context, deleteFn)
  };
};

const equalsResource = (candidate: FileSystemState, current: FileSystemState) => {
  return !!candidate.result && candidate.result.fileSystemArn === current.result?.fileSystemArn;
};

const previewResource = (candidate: FileSystemState, current: FileSystemState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.fileSystemName
  };
};

const replaceResource = async (
  candidate: FileSystemState,
  current: FileSystemState,
  createFn: (logger: OperationLogLine, parameters: FileSystemParameters) => Promise<FileSystemResult>
) => {
  if (current.result) {
    throw new ReplaceResourceError(FileSystemServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate, createFn);
};

const createResource = (
  candidate: FileSystemState,
  createFn: (logger: OperationLogLine, parameters: FileSystemParameters) => Promise<FileSystemResult>
): Promise<FileSystemResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(FileSystemServiceName, parameters.fileSystemName, 'creation', async (logger) => {
    const result = await createFn(logger, parameters);
    candidate.result = result;
    return result;
  });
};

const updateResource = async (candidate: FileSystemState, _current: FileSystemState) => {
  const { result, parameters } = candidate;
  const { fileSystemName } = parameters;

  if (!result) {
    throw new CorruptedResourceError(FileSystemServiceName, fileSystemName);
  }

  return Promise.resolve();
};

const deleteResource = async (
  current: FileSystemState,
  context: StepContext,
  deleteFn: (logger: OperationLogLine, result: FileSystemResult) => Promise<void>
) => {
  const { result, parameters } = current;

  if (result && allowForcedDeletion(context, 'EFS file system', parameters.fileSystemName)) {
    return OperationLogger.logExecution(FileSystemServiceName, parameters.fileSystemName, 'deletion', async (logger) => {
      await deleteFn(logger, result);
    });
  }
};
