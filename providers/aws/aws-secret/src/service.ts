import type { EntryState, EntryStates } from '@ez4/state';
import type { SecretParameters, SecretState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData } from '@ez4/utils';
import { SecretServiceType } from './types';

export const createSecretStateId = (secretName: string) => {
  return hashData(SecretServiceType, secretName);
};

export const createSecret = <E extends EntryState>(state: EntryStates<E>, parameters: SecretParameters): SecretState => {
  const entryId = createSecretStateId(parameters.secretName);

  return attachEntry<E | SecretState, SecretState>(state, {
    type: SecretServiceType,
    entryId,
    dependencies: [],
    parameters
  });
};
