import type { EntryState, EntryStates } from '@ez4/state';
import type { EcsClusterParameters, EcsClusterState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData, toKebabCase } from '@ez4/utils';
import { EcsClusterServiceType } from './types';

export const createEcsClusterStateId = (clusterName: string) => {
  return hashData(EcsClusterServiceType, toKebabCase(clusterName));
};

export const createEcsCluster = <E extends EntryState>(
  state: EntryStates<E>,
  parameters: EcsClusterParameters
): EcsClusterState => {
  const entryId = createEcsClusterStateId(parameters.clusterName);

  return attachEntry<E | EcsClusterState, EcsClusterState>(state, {
    type: EcsClusterServiceType,
    entryId,
    dependencies: [],
    parameters
  });
};
