import type { VpcTag } from '@ez4/aws-vpc';

import { getDefaultVpcId, getTaggedSecurityGroupIds, getTaggedSubnetIds } from '@ez4/aws-vpc';
import { MissingAgentNetworkError } from './errors';

export const AgentNetworkTag: VpcTag = {
  key: 'ez4:agents',
  value: 'true'
};
export const AgentProxyNetworkTag: VpcTag = {
  key: 'ez4:agents-proxy',
  value: 'true'
};


export interface AgentNetworkConfig {
  vpcId: string;
  subnetIds: string[];
  securityGroupIds: string[];
  proxySecurityGroupIds: string[];
}

export type NetworkLookup = {
  getDefaultVpcId: () => Promise<string | undefined>;
  getTaggedSubnetIds: (vpcId: string, tag: VpcTag) => Promise<string[]>;
  getTaggedSecurityGroupIds: (vpcId: string, tag: VpcTag) => Promise<string[]>;
};

const defaultLookup: NetworkLookup = {
  getDefaultVpcId,
  getTaggedSubnetIds,
  getTaggedSecurityGroupIds
};

export const discoverAgentNetwork = async (vpcId?: string, lookup: NetworkLookup = defaultLookup): Promise<AgentNetworkConfig> => {
  const resolvedVpcId = vpcId ?? (await lookup.getDefaultVpcId());

  if (!resolvedVpcId) {
    throw new MissingAgentNetworkError('no VPC found or specified');
  }

  const [subnetIds, securityGroupIds, proxySecurityGroupIds] = await Promise.all([
    lookup.getTaggedSubnetIds(resolvedVpcId, AgentNetworkTag),
    lookup.getTaggedSecurityGroupIds(resolvedVpcId, AgentNetworkTag),
    lookup.getTaggedSecurityGroupIds(resolvedVpcId, AgentProxyNetworkTag)
  ]);

  if (!subnetIds || subnetIds.length === 0) {
    throw new MissingAgentNetworkError(`no subnets found with tag 'ez4:agents=true' in VPC ${resolvedVpcId}`);
  }

  if (!securityGroupIds || securityGroupIds.length === 0) {
    throw new MissingAgentNetworkError(`no security groups found with tag 'ez4:agents=true' in VPC ${resolvedVpcId}`);
  }
  if (!proxySecurityGroupIds || proxySecurityGroupIds.length === 0) {
    throw new MissingAgentNetworkError(`no security groups found with tag 'ez4:agents-proxy=true' in VPC ${resolvedVpcId}`);
  }


  return {
    vpcId: resolvedVpcId,
    subnetIds,
    securityGroupIds,
    proxySecurityGroupIds
  };
};
