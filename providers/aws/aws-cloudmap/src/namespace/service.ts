import type { EntryState, EntryStates } from '@ez4/state';
import type { NamespaceParameters, NamespaceState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData } from '@ez4/utils';
import { NamespaceServiceType } from './types';

export const createNamespaceStateId = (namespaceName: string) => {
  return hashData(NamespaceServiceType, namespaceName);
};

export const createNamespace = <E extends EntryState>(state: EntryStates<E>, parameters: NamespaceParameters): NamespaceState => {
  const entryId = createNamespaceStateId(parameters.namespaceName);

  return attachEntry<E | NamespaceState, NamespaceState>(state, {
    type: NamespaceServiceType,
    entryId,
    dependencies: [],
    parameters
  });
};
