import type { EntryState, EntryStates } from '@ez4/state';
import type { FileSystemParameters, FileSystemState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData } from '@ez4/utils';
import { FileSystemServiceType } from './types';

export const createFileSystemStateId = (fileSystemName: string) => {
  return hashData(FileSystemServiceType, fileSystemName);
};

export const isFileSystemState = (entry: EntryState): entry is FileSystemState => {
  return entry.type === FileSystemServiceType;
};

export const createFileSystem = <E extends EntryState>(state: EntryStates<E>, parameters: FileSystemParameters): FileSystemState => {
  const entryId = createFileSystemStateId(parameters.fileSystemName);

  return attachEntry<E | FileSystemState, FileSystemState>(state, {
    type: FileSystemServiceType,
    entryId,
    dependencies: [],
    parameters
  });
};
