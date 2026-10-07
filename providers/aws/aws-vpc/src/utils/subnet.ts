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
