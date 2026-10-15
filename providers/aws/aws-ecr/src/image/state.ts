import type { EntryState, EntryStates } from '@ez4/state';
import type { EcrRepositoryState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData, toKebabCase } from '@ez4/utils';

export const EcrImageServiceName = 'AWS:ECR/Image';

export const EcrImageServiceType = 'aws:ecr.image';

export type EcrImageParameters = {
  agentName: string;
  dockerfile: string;
  bundleFile: string;
  bundleHash: string;
  imageTag: string;
};

export type EcrImageResult = {
  imageUri: string;
};

export type EcrImageState = EntryState & {
  type: typeof EcrImageServiceType;
  parameters: EcrImageParameters;
  result?: EcrImageResult;
};

export const createEcrImageStateId = (agentName: string) => {
  return hashData(EcrImageServiceType, toKebabCase(agentName));
};

export const isEcrImageState = (entry: EntryState): entry is EcrImageState => {
  return entry.type === EcrImageServiceType;
};

export const createAgentImage = <E extends EntryState>(
  state: EntryStates<E>,
  repository: EcrRepositoryState,
  parameters: EcrImageParameters
): EcrImageState => {
  const entryId = createEcrImageStateId(parameters.agentName);

  return attachEntry<E | EcrImageState, EcrImageState>(state, {
    type: EcrImageServiceType,
    entryId,
    dependencies: [repository.entryId],
    parameters
  });
};
