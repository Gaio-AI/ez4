import type { Volume, RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';
import type { EntryState, EntryStates, StepContext } from '@ez4/state';
import type { EcsTaskDefParameters, EcsTaskDefState } from './types';
import { attachEntry } from '@ez4/state';
import { hashData, toKebabCase } from '@ez4/utils';
import { EcsTaskDefServiceType } from './types';

export const createEcsTaskDefStateId = (family: string) => hashData(EcsTaskDefServiceType, toKebabCase(family));

export const buildEfsVolume = (name: string, fileSystemId: string, accessPointId: string): Volume => ({
  name,
  efsVolumeConfiguration: {
    fileSystemId,
    transitEncryption: 'ENABLED',
    authorizationConfig: { accessPointId, iam: 'ENABLED' }
  }
});

export type EcsTaskDefInput = {
  family: string;
  getTaskDefinition?: (context: StepContext) => RegisterTaskDefinitionCommandInput;
  getTaskDefinitionHash?: () => string;
  hash?: string;
  subnetIds: string[];
  securityGroupIds: string[];
  tags?: EcsTaskDefParameters['tags'];
};

export const createEcsTaskDefinition = <E extends EntryState>(
  state: EntryStates<E>,
  dependencies: (EntryState | string)[],
  parameters: EcsTaskDefInput
): EcsTaskDefState => {
  const hash = parameters.hash ?? parameters.getTaskDefinitionHash?.() ?? hashData(parameters.family);
  const getTaskDefinition = parameters.getTaskDefinition ?? (() => ({ family: parameters.family, containerDefinitions: [] }));
  const taskDefParameters: EcsTaskDefParameters = {
    family: parameters.family,
    subnetIds: parameters.subnetIds,
    securityGroupIds: parameters.securityGroupIds,
    tags: parameters.tags,
    getTaskDefinition,
    hash
  };
  return attachEntry<E | EcsTaskDefState, EcsTaskDefState>(state, {
    type: EcsTaskDefServiceType,
    entryId: createEcsTaskDefStateId(parameters.family),
    dependencies: dependencies.map((dep) => (typeof dep === 'string' ? dep : dep.entryId)),
    parameters: taskDefParameters
  });
};
