import type { VpcTag } from './tags';

import { DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { getEC2Client } from './client';
import { getTagFilter } from './tags';

export const getDefaultSecurityGroupId = async (vpcId: string) => {
  const result = await getEC2Client().send(
    new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: 'vpc-id',
          Values: [vpcId]
        },
        {
          Name: 'group-name',
          Values: ['default']
        }
      ]
    })
  );

  return result.SecurityGroups?.[0].GroupId;
};

export const getTaggedSecurityGroupIds = async (vpcId: string, tag: VpcTag) => {
  const result = await getEC2Client().send(
    new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: 'vpc-id',
          Values: [vpcId]
        },
        getTagFilter(tag)
      ]
    })
  );

  return (result.SecurityGroups ?? []).map((group) => group.GroupId!).sort();
};
