import type { RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';
import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState, StepContext } from '@ez4/state';

export const EcsServiceServiceName = 'AWS:ECS/Service';
export const EcsServiceServiceType = 'aws:ecs.service';

export type EcsServiceParameters = {
  serviceName: string;
  clusterName: string;
  subnetIds: string[];
  securityGroupIds: string[];
  getTaskDefinition: (context: StepContext) => RegisterTaskDefinitionCommandInput;
  getServiceRegistryArn: (context: StepContext) => string;
  hash: string;
  tags?: ResourceTags;
};

export type EcsServiceResult = { serviceArn: string; taskDefinitionArn: string };
export type EcsServiceState = EntryState & {
  type: typeof EcsServiceServiceType;
  parameters: EcsServiceParameters;
  result?: EcsServiceResult;
};
