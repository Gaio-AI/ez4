import type { VpcTag, SubnetInfo } from '@ez4/aws-vpc';

import { getDefaultVpcId, findSubnetsByTag, findSecurityGroupsByTag, getTaggedSecurityGroupIds, getTaggedSubnetIds } from '@ez4/aws-vpc';
import { MissingAgentNetworkError } from './errors';

export const AgentNetworkTag: VpcTag = {
  key: 'ez4:agents',
  value: 'true'
};
export const AgentProxyNetworkTag: VpcTag = {
  key: 'ez4:agents-proxy',
  value: 'true'
};
export const AgentEfsNetworkTag: VpcTag = {
  key: 'ez4:agents-efs',
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
  findSubnetsByTag?: (tag: VpcTag, vpcId?: string) => Promise<SubnetInfo[]>;
  findSecurityGroupsByTag?: (tag: VpcTag, vpcId?: string) => Promise<string[]>;
  getTaggedSubnetIds?: (vpcId: string, tag: VpcTag) => Promise<string[]>;
  getTaggedSecurityGroupIds?: (vpcId: string, tag: VpcTag) => Promise<string[]>;
};

const defaultLookup: NetworkLookup = {
  getDefaultVpcId,
  findSubnetsByTag,
  findSecurityGroupsByTag,
  getTaggedSubnetIds,
  getTaggedSecurityGroupIds
};

export const discoverAgentNetwork = async (vpcId?: string, lookup: NetworkLookup = defaultLookup): Promise<AgentNetworkConfig> => {
  const resolvedVpcId = vpcId ?? (await lookup.getDefaultVpcId());

  if (!resolvedVpcId) {
    throw new MissingAgentNetworkError("no VPC found or specified with tag 'ez4:agents=true'");
  }

  const querySubnets = async (tag: VpcTag) => {
    if (lookup.findSubnetsByTag) {
      const subnets = await lookup.findSubnetsByTag(tag, resolvedVpcId);
      return subnets.map((subnet) => subnet.subnetId);
    }
    return lookup.getTaggedSubnetIds!(resolvedVpcId, tag);
  };

  const querySecurityGroups = async (tag: VpcTag) => {
    if (lookup.findSecurityGroupsByTag) {
      return lookup.findSecurityGroupsByTag(tag, resolvedVpcId);
    }
    return lookup.getTaggedSecurityGroupIds!(resolvedVpcId, tag);
  };

  const [subnetIds, securityGroupIds, proxySecurityGroupIds] = await Promise.all([
    querySubnets(AgentNetworkTag),
    querySecurityGroups(AgentNetworkTag),
    querySecurityGroups(AgentProxyNetworkTag)
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
