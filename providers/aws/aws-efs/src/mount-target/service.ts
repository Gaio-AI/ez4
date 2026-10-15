import type { EntryState, EntryStates } from '@ez4/state';
import type { FileSystemState } from '../filesystem/types';
import type { MountTargetParameters, MountTargetState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData } from '@ez4/utils';
import { MountTargetServiceType } from './types';

export const createMountTargetStateId = (fileSystemStateId: string, subnetId: string) => {
  return hashData(MountTargetServiceType, fileSystemStateId, subnetId);
};

export const isMountTargetState = (entry: EntryState): entry is MountTargetState => {
  return entry.type === MountTargetServiceType;
};

export const createMountTarget = <E extends EntryState>(
  state: EntryStates<E>,
  fileSystem: FileSystemState,
  parameters: MountTargetParameters
): MountTargetState => {
  const entryId = createMountTargetStateId(fileSystem.entryId, parameters.subnetId);

  return attachEntry<E | MountTargetState, MountTargetState>(state, {
    type: MountTargetServiceType,
    entryId,
    dependencies: [fileSystem.entryId],
    parameters
  });
};

export const pickSubnetPerZone = (subnets: { subnetId: string; availabilityZone: string }[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const { subnetId, availabilityZone } of subnets) {
    if (!seen.has(availabilityZone)) {
      seen.add(availabilityZone);
      result.push(subnetId);
    }
  }

  return result;
};
