import type { EntryState, EntryStates } from '@ez4/state';
import type { EcsServiceParameters, EcsServiceState } from './types';
import { attachEntry } from '@ez4/state';
import { hashData } from '@ez4/utils';
import { EcsServiceServiceType } from './types';

export const createEcsServiceStateId = (serviceName: string) => hashData(EcsServiceServiceType, serviceName);

export const createEcsService = <E extends EntryState>(
  state: EntryStates<E>,
  dependencies: EntryState[],
  parameters: EcsServiceParameters
): EcsServiceState =>
  attachEntry<E | EcsServiceState, EcsServiceState>(state, {
    type: EcsServiceServiceType,
    entryId: createEcsServiceStateId(parameters.serviceName),
    dependencies: dependencies.map(({ entryId }) => entryId),
    parameters
  });
