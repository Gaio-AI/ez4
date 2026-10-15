import type { EntryState, EntryStates } from '@ez4/state';
import type { ProviderCredentialParameters, ProviderCredentialState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData, toKebabCase } from '@ez4/utils';

import { ProviderCredentialServiceType } from './types';

export const createProviderCredentialStateId = (secretName: string) => {
  return hashData(ProviderCredentialServiceType, toKebabCase(secretName));
};

export const createProviderCredential = <E extends EntryState>(
  state: EntryStates<E>,
  parameters: ProviderCredentialParameters
): ProviderCredentialState => {
  const entryId = createProviderCredentialStateId(parameters.secretName);

  return attachEntry<E | ProviderCredentialState, ProviderCredentialState>(state, {
    type: ProviderCredentialServiceType,
    entryId,
    dependencies: [],
    parameters
  });
};
