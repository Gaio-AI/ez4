import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';
import type { AgentService } from '@ez4/agent/library';

export const EcsTaskDefServiceName = 'AWS:ECS/TaskDefinition';

export const EcsTaskDefServiceType = 'aws:ecs.taskdef';

export type AgentRuntimeFields = Pick<AgentService, 'name' | 'resources' | 'secrets'>;

export type EcsTaskDefParameters = {
  agentName: string;
  baseName: string;
  agent: AgentRuntimeFields;
  bucketName: string;
  region: string;
  subnetIds: string[];
  securityGroupIds: string[];
  proxyUrl?: string;
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
