import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';

export const NamespaceServiceName = 'AWS:ServiceDiscovery/Namespace';

export const NamespaceServiceType = 'aws:servicediscovery.namespace';

export type NamespaceParameters = {
  namespaceName: string;
  vpcId: string;
  serviceName: string;
  tags?: ResourceTags;
};

export type NamespaceResult = {
  namespaceId: string;
  namespaceArn: string;
  discoveryServiceId: string;
  discoveryServiceArn: string;
};

export type NamespaceState = EntryState & {
  type: typeof NamespaceServiceType;
  parameters: NamespaceParameters;
  result?: NamespaceResult;
};
