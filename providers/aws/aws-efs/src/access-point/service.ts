import type { EntryState, EntryStates } from '@ez4/state';
import type { FileSystemState } from '../filesystem/types';
import type { AccessPointParameters, AccessPointState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData } from '@ez4/utils';
import { AccessPointServiceType } from './types';

export const createAccessPointStateId = (fileSystemStateId: string, accessPointName: string) => {
  return hashData(AccessPointServiceType, fileSystemStateId, accessPointName);
};

export const isAccessPointState = (entry: EntryState): entry is AccessPointState => {
  return entry.type === AccessPointServiceType;
};

export const createAccessPoint = <E extends EntryState>(
  state: EntryStates<E>,
  fileSystem: FileSystemState,
  parameters: AccessPointParameters
): AccessPointState => {
  const entryId = createAccessPointStateId(fileSystem.entryId, parameters.accessPointName);

  return attachEntry<E | AccessPointState, AccessPointState>(state, {
    type: AccessPointServiceType,
    entryId,
    dependencies: [fileSystem.entryId],
    parameters
  });
};
