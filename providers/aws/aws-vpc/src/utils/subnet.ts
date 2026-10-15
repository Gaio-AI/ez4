import type { VpcTag } from './tags';

import { DescribeSubnetsCommand } from '@aws-sdk/client-ec2';
import { getEC2Client } from './client';
import { getTagFilter } from './tags';

export const getDefaultSubnetIds = async (vpcId: string) => {
  const response = await getEC2Client().send(
    new DescribeSubnetsCommand({
      Filters: [
        {
          Name: 'vpc-id',
          Values: [vpcId]
        }
      ]
    })
  );

  return response.Subnets?.map((subnet) => subnet.SubnetId!);
};

export const getTaggedSubnetIds = async (vpcId: string, tag: VpcTag) => {
  const response = await getEC2Client().send(
    new DescribeSubnetsCommand({
      Filters: [
        {
          Name: 'vpc-id',
          Values: [vpcId]
        },
        getTagFilter(tag)
      ]
    })
  );

  return (response.Subnets ?? []).map((subnet) => subnet.SubnetId!).sort();
};

/**
 * Whether every given subnet has an IPv6 block: a function only sends IPv6 traffic when all of its subnets are
 * dual-stack.
 */
export const areDualStackSubnets = async (subnetIds: string[]) => {
  if (!subnetIds.length) {
    return false;
  }

  const response = await getEC2Client().send(
    new DescribeSubnetsCommand({
      SubnetIds: subnetIds
    })
  );

  const subnets = response.Subnets ?? [];

  return (
    subnets.length === subnetIds.length &&
    subnets.every(({ Ipv6CidrBlockAssociationSet = [] }) => {
      return Ipv6CidrBlockAssociationSet.some(({ Ipv6CidrBlockState }) => Ipv6CidrBlockState?.State === 'associated');
    })
  );
};
