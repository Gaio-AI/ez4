import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';

export const AgentNamespaceServiceName = 'AWS:ServiceDiscovery/Namespace';

export const AgentNamespaceServiceType = 'aws:servicediscovery.namespace';

export type AgentNamespaceParameters = {
  namespaceName: string;
  vpcId: string;
  serviceName: string;
  tags?: ResourceTags;
};

export type AgentNamespaceResult = {
  namespaceId: string;
  namespaceArn: string;
  discoveryServiceId: string;
  discoveryServiceArn: string;
};

export type AgentNamespaceState = EntryState & {
  type: typeof AgentNamespaceServiceType;
  parameters: AgentNamespaceParameters;
  result?: AgentNamespaceResult;
};
