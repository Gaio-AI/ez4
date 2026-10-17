import type { VpcTag } from '@ez4/aws-vpc';
import { describe, it } from 'node:test';
import { rejects, ok, deepEqual, throws } from 'node:assert/strict';
import { discoverAgentNetwork, getAgentSecurityGroupIds } from '../src/network/discovery';
import { MissingAgentNetworkError } from '../src/network/errors';

describe('agent network discovery', () => {
  it('assert :: throws MissingAgentNetworkError when no VPC found and none provided', async () => {
    const mockLookup = {
      getDefaultVpcId: async () => undefined,
      getTaggedSubnetIds: async () => [],
      getTaggedSecurityGroupIds: async () => []
    };

    await rejects(
      async () => {
        await discoverAgentNetwork(undefined, mockLookup);
      },
      (error: unknown) => {
        ok(error instanceof MissingAgentNetworkError);
        ok(error.message.includes('ez4:agents'));
        return true;
      }
    );
  });

  it('assert :: throws MissingAgentNetworkError when no tagged subnets exist', async () => {
    const mockLookup = {
      getDefaultVpcId: async () => 'vpc-12345',
      getTaggedSubnetIds: async () => [],
      getTaggedSecurityGroupIds: async (_vpc: string, tag: VpcTag) => (tag.key === 'ez4:agents-proxy' ? ['sg-proxy'] : ['sg-123'])
    };

    await rejects(
      async () => {
        await discoverAgentNetwork('vpc-12345', mockLookup);
      },
      (error: unknown) => {
        ok(error instanceof MissingAgentNetworkError);
        ok(error.message.includes('ez4:agents'));
        ok(error.message.includes('subnets'));
        return true;
      }
    );
  });

  it('assert :: throws MissingAgentNetworkError when no tagged security groups exist', async () => {
    const mockLookup = {
      getDefaultVpcId: async () => 'vpc-12345',
      getTaggedSubnetIds: async () => ['subnet-1', 'subnet-2'],
      getTaggedSecurityGroupIds: async (_vpc: string, tag: VpcTag) => (tag.key === 'ez4:agents-proxy' ? ['sg-proxy'] : [])
    };

    await rejects(
      async () => {
        await discoverAgentNetwork('vpc-12345', mockLookup);
      },
      (error: unknown) => {
        ok(error instanceof MissingAgentNetworkError);
        ok(error.message.includes('ez4:agents'));
        ok(error.message.includes('security groups'));
        return true;
      }
    );
  });
  it('assert :: throws MissingAgentNetworkError when no tagged proxy security groups exist', async () => {
    const mockLookup = {
      getDefaultVpcId: async () => 'vpc-12345',
      getTaggedSubnetIds: async () => ['subnet-1', 'subnet-2'],
      getTaggedSecurityGroupIds: async (_vpc: string, tag: VpcTag) => (tag.key === 'ez4:agents' ? ['sg-agents'] : [])
    };

    await rejects(
      async () => {
        await discoverAgentNetwork('vpc-12345', mockLookup);
      },
      (error: unknown) => {
        ok(error instanceof MissingAgentNetworkError);
        ok(error.message.includes('ez4:agents-proxy'));
        ok(error.message.includes('security groups'));
        return true;
      }
    );
  });

  it('assert :: returns subnets and security groups when discovered', async () => {
    const mockLookup = {
      getDefaultVpcId: async () => 'vpc-12345',
      getTaggedSubnetIds: async () => ['subnet-1', 'subnet-2'],
      getTaggedSecurityGroupIds: async (_vpc: string, tag: VpcTag) => {
        return { 'ez4:agents': ['sg-agents'], 'ez4:agents-proxy': ['sg-proxy'], 'ez4:agents-vpc': ['sg-vpc'] }[tag.key] ?? [];
      }
    };

    const network = await discoverAgentNetwork('vpc-12345', mockLookup);
    deepEqual(network, {
      vpcId: 'vpc-12345',
      subnetIds: ['subnet-1', 'subnet-2'],
      securityGroupIds: ['sg-agents'],
      proxySecurityGroupIds: ['sg-proxy'],
      vpcSecurityGroupIds: ['sg-vpc']
    });
  });

  it('assert :: an environment without the vpc security group is still discovered', async () => {
    const mockLookup = {
      getDefaultVpcId: async () => 'vpc-12345',
      getTaggedSubnetIds: async () => ['subnet-1'],
      getTaggedSecurityGroupIds: async (_vpc: string, tag: VpcTag) => (tag.key === 'ez4:agents-vpc' ? [] : ['sg-any'])
    };

    const network = await discoverAgentNetwork('vpc-12345', mockLookup);
    deepEqual(network.vpcSecurityGroupIds, []);
  });

  it('assert :: a vpc agent runs in the agents and the vpc security groups', () => {
    const network = {
      vpcId: 'v',
      subnetIds: [],
      securityGroupIds: ['sg-agents'],
      proxySecurityGroupIds: [],
      vpcSecurityGroupIds: ['sg-vpc']
    };

    deepEqual(getAgentSecurityGroupIds(network, true), ['sg-agents', 'sg-vpc']);
    deepEqual(getAgentSecurityGroupIds(network, false), ['sg-agents']);
    deepEqual(getAgentSecurityGroupIds(network, undefined), ['sg-agents']);
  });

  it('assert :: a vpc agent without a vpc security group is refused', () => {
    const network = { vpcId: 'vpc-9', subnetIds: [], securityGroupIds: ['sg-agents'], proxySecurityGroupIds: [], vpcSecurityGroupIds: [] };

    throws(
      () => getAgentSecurityGroupIds(network, true),
      (error: unknown) => {
        ok(error instanceof MissingAgentNetworkError);
        ok(error.message.includes('ez4:agents-vpc'));
        return true;
      }
    );
    deepEqual(getAgentSecurityGroupIds(network, false), ['sg-agents']);
  });
});
