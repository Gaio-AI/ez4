import type { RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';
import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState, StepContext } from '@ez4/state';

export const EcsTaskDefServiceName = 'AWS:ECS/TaskDefinition';
export const EcsTaskDefServiceType = 'aws:ecs.taskdef';

export type EcsTaskDefParameters = {
  family: string;
  getTaskDefinition: (context: StepContext) => RegisterTaskDefinitionCommandInput;
  hash: string;
  subnetIds: string[];
  securityGroupIds: string[];
  tags?: ResourceTags;
};

export type EcsTaskDefResult = {
  taskDefinitionArn: string;
  family: string;
  revision: number;
  subnetIds: string[];
  securityGroupIds: string[];
};

export type EcsTaskDefState = EntryState & {
  type: typeof EcsTaskDefServiceType;
  parameters: EcsTaskDefParameters;
  result?: EcsTaskDefResult;
};
