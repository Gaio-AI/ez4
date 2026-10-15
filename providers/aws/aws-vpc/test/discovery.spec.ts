import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { findSubnetsByTag, findSecurityGroupsByTag, type Ec2ClientPort } from '../src/discovery';

const fakeEc2 = (subnets: Array<{ SubnetId: string; AvailabilityZone: string }>): Ec2ClientPort => ({
  send: async () => ({ Subnets: subnets })
});

const fakeEc2Sg = (groups: Array<{ GroupId: string }>): Ec2ClientPort => ({
  send: async () => ({ SecurityGroups: groups })
});

describe('VPC tag discovery', () => {
  it('assert :: subnets are returned with their availability zone', async () => {
    const subnets = await findSubnetsByTag({ key: 'ez4:agents', value: 'true' }, 'vpc-1', fakeEc2([{ SubnetId: 's-1', AvailabilityZone: 'us-east-1b' }]));
    deepEqual(subnets, [{ subnetId: 's-1', availabilityZone: 'us-east-1b' }]);
  });

  it('assert :: security groups are returned by tag', async () => {
    const sgs = await findSecurityGroupsByTag({ key: 'ez4:agents', value: 'true' }, 'vpc-1', fakeEc2Sg([{ GroupId: 'sg-1' }]));
    deepEqual(sgs, ['sg-1']);
  });
});
