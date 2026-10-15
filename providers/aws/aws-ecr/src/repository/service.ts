import type { EntryState, EntryStates } from '@ez4/state';
import type { EcrRepositoryParameters, EcrRepositoryState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData, toKebabCase } from '@ez4/utils';
import { EcrRepositoryServiceType } from './types';

export const createEcrRepositoryStateId = (repositoryName: string) => {
  return hashData(EcrRepositoryServiceType, toKebabCase(repositoryName));
};

export const createEcrRepository = <E extends EntryState>(
  state: EntryStates<E>,
  parameters: EcrRepositoryParameters
): EcrRepositoryState => {
  const entryId = createEcrRepositoryStateId(parameters.repositoryName);

  return attachEntry<E | EcrRepositoryState, EcrRepositoryState>(state, {
    type: EcrRepositoryServiceType,
    entryId,
    dependencies: [],
    parameters
  });
};
