import type { EntryState, EntryStates } from '@ez4/state';
import type { KeyParameters, KeyState } from './types';

import { attachEntry } from '@ez4/state';

import { createKeyStateId } from './utils';
import { KeyServiceType } from './types';

export const createKey = <E extends EntryState>(state: EntryStates<E>, parameters: KeyParameters) => {
  const keyId = createKeyStateId(parameters.aliasName);

  return attachEntry<E | KeyState, KeyState>(state, {
    type: KeyServiceType,
    entryId: keyId,
    dependencies: [],
    parameters
  });
};
