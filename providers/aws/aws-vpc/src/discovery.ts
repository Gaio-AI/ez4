import type { Filter } from '@aws-sdk/client-ec2';
import { DescribeSecurityGroupsCommand, DescribeSubnetsCommand } from '@aws-sdk/client-ec2';
import { getEC2Client } from './utils/client';
import { getTagFilter } from './utils/tags';

export type SubnetInfo = {
  subnetId: string;
  availabilityZone: string;
};

export type Ec2ClientPort = {
  send: (command: unknown) => Promise<{
    Subnets?: Array<{ SubnetId?: string; AvailabilityZone?: string }>;
    SecurityGroups?: Array<{ GroupId?: string }>;
  }>;
};

export const findSubnetsByTag = async (
  tag: { key: string; value: string },
  vpcId?: string,
  client?: Ec2ClientPort
): Promise<SubnetInfo[]> => {
  const filters: Filter[] = [getTagFilter(tag)];

  if (vpcId) {
    filters.push({
      Name: 'vpc-id',
      Values: [vpcId]
    });
  }

  const ec2 = client ?? (getEC2Client() as unknown as Ec2ClientPort);
  const response = await ec2.send(
    new DescribeSubnetsCommand({
      Filters: filters
    })
  );

  return (response.Subnets ?? [])
    .filter((subnet): subnet is { SubnetId: string; AvailabilityZone: string } => !!subnet.SubnetId && !!subnet.AvailabilityZone)
    .map((subnet) => ({
      subnetId: subnet.SubnetId,
      availabilityZone: subnet.AvailabilityZone
    }));
};

export const findSecurityGroupsByTag = async (
  tag: { key: string; value: string },
  vpcId?: string,
  client?: Ec2ClientPort
): Promise<string[]> => {
  const filters: Filter[] = [getTagFilter(tag)];

  if (vpcId) {
    filters.push({
      Name: 'vpc-id',
      Values: [vpcId]
    });
  }

  const ec2 = client ?? (getEC2Client() as unknown as Ec2ClientPort);
  const response = await ec2.send(
    new DescribeSecurityGroupsCommand({
      Filters: filters
    })
  );

  return (response.SecurityGroups ?? [])
    .map((group) => group.GroupId!)
    .filter((id): id is string => !!id)
    .sort();
};
