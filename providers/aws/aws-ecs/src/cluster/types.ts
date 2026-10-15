import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';

export const EcsClusterServiceName = 'AWS:ECS/Cluster';

export const EcsClusterServiceType = 'aws:ecs.cluster';

export type EcsClusterParameters = {
  clusterName: string;
  tags?: ResourceTags;
};

export type EcsClusterResult = {
  clusterName: string;
  clusterArn: string;
};

export type EcsClusterState = EntryState & {
  type: typeof EcsClusterServiceType;
  parameters: EcsClusterParameters;
  result?: EcsClusterResult;
};
