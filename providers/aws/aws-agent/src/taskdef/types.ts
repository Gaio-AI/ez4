import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';
import type { RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';

export const EcsTaskDefServiceName = 'AWS:ECS/TaskDefinition';

export const EcsTaskDefServiceType = 'aws:ecs.taskdef';

export type EcsTaskDefParameters = {
  agentName: string;
  taskDefinition: RegisterTaskDefinitionCommandInput;
  tags?: ResourceTags;
};

export type EcsTaskDefResult = {
  taskDefinitionArn: string;
  family: string;
  revision: number;
};

export type EcsTaskDefState = EntryState & {
  type: typeof EcsTaskDefServiceType;
  parameters: EcsTaskDefParameters;
  result?: EcsTaskDefResult;
};
