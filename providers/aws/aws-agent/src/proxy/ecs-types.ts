import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';

export const ProxyServiceServiceName = 'AWS:ECS/Service';

export const ProxyServiceServiceType = 'aws:ecs.service';

export type ProxyServiceParameters = {
  serviceName: string;
  baseName: string;
  clusterName: string;
  squidConfig: string;
  region: string;
  subnetIds: string[];
  securityGroupIds: string[];
  tags?: ResourceTags;
};

export type ProxyServiceResult = {
  serviceArn: string;
  taskDefinitionArn: string;
};

export type ProxyServiceState = EntryState & {
  type: typeof ProxyServiceServiceType;
  parameters: ProxyServiceParameters;
  result?: ProxyServiceResult;
};
