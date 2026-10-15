import type { EntryState, EntryStates } from '@ez4/state';
import type { EcrRepositoryState } from '../repository/types';

import { attachEntry } from '@ez4/state';
import { hashData, toKebabCase } from '@ez4/utils';

export const EcrImageServiceName = 'AWS:ECR/Image';

export const EcrImageServiceType = 'aws:ecr.image';

export type EcrImageParameters = {
  imageName: string;
  agentName?: string;
  dockerfile: string;
  bundleFile: string;
  bundleHash: string;
  imageTag: string;
};

export type EcrImageInput = {
  imageName?: string;
  agentName?: string;
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

export const createEcrImageStateId = (imageName: string) => {
  return hashData(EcrImageServiceType, toKebabCase(imageName));
};

export const isEcrImageState = (entry: EntryState): entry is EcrImageState => {
  return entry.type === EcrImageServiceType;
};

export const createEcrImage = <E extends EntryState>(
  state: EntryStates<E>,
  repository: EcrRepositoryState,
  parameters: EcrImageInput
): EcrImageState => {
  const imageName = parameters.imageName ?? parameters.agentName ?? 'image';
  const entryId = createEcrImageStateId(imageName);

  return attachEntry<E | EcrImageState, EcrImageState>(state, {
    type: EcrImageServiceType,
    entryId,
    dependencies: [repository.entryId],
    parameters: {
      ...parameters,
      imageName
    }
  });
};
export const createAgentImage = createEcrImage;
