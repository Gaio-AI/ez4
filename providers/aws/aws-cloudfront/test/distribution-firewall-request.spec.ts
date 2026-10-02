import type { OperationLogLine } from '@ez4/aws-common';
import type { UpdateRequest } from '../src/distribution/client';

import { afterEach, describe, it, mock } from 'node:test';
import { equal } from 'node:assert/strict';

import {
  CloudFrontClient,
  CreateDistributionWithTagsCommand,
  GetDistributionCommand,
  UpdateDistributionCommand
} from '@aws-sdk/client-cloudfront';

import { createDistribution, updateDistribution } from '../src/distribution/client';

const FIREWALL_ARN = 'arn:aws:wafv2:us-east-1:000000000000:global/webacl/ez4-test/a1b2c3d4-0000-1111-2222-333344445555';

const logger: OperationLogLine = {
  update: () => {}
};

const request: UpdateRequest = {
  distributionName: 'ez4-test-firewall',
  enabled: true,
  defaultOrigin: {
    id: 'ez4-default',
    domain: 'origin.ez4.test',
    cachePolicyId: 'cache-policy-id'
  }
};

const distribution = {
  Id: 'E000000000000',
  ARN: 'arn:aws:cloudfront::000000000000:distribution/E000000000000',
  DomainName: 'ez4.cloudfront.net',
  Status: 'Deployed'
};

// Answers every call like a deployed distribution whose web ACL is `currentWebAclId`, and keeps the
// configuration each create or update sent.
const mockCloudFront = (currentWebAclId: string) => {
  const sentConfigs: { WebACLId?: string }[] = [];

  mock.method(CloudFrontClient.prototype, 'send', async (command: unknown) => {
    if (command instanceof CreateDistributionWithTagsCommand) {
      sentConfigs.push(command.input.DistributionConfigWithTags!.DistributionConfig!);
    }

    if (command instanceof UpdateDistributionCommand) {
      sentConfigs.push(command.input.DistributionConfig!);
    }

    if (command instanceof GetDistributionCommand) {
      return {
        ETag: 'etag',
        Distribution: {
          ...distribution,
          DistributionConfig: {
            WebACLId: currentWebAclId
          }
        }
      };
    }

    return {
      Distribution: distribution
    };
  });

  return sentConfigs;
};

describe('cloudfront :: distribution firewall request', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: create with the declared web acl', async () => {
    const sentConfigs = mockCloudFront('');

    await createDistribution(logger, { ...request, firewallArn: FIREWALL_ARN });

    equal(sentConfigs.length, 1);
    equal(sentConfigs[0]?.WebACLId, FIREWALL_ARN);
  });

  it('assert :: update to the declared web acl', async () => {
    const sentConfigs = mockCloudFront('');

    await updateDistribution(logger, distribution.Id, { ...request, firewallArn: FIREWALL_ARN });

    equal(sentConfigs.length, 1);
    equal(sentConfigs[0]?.WebACLId, FIREWALL_ARN);
  });

  it('assert :: update without firewall takes the web acl away', async () => {
    const sentConfigs = mockCloudFront(FIREWALL_ARN);

    await updateDistribution(logger, distribution.Id, request);

    equal(sentConfigs.length, 1);
    equal(sentConfigs[0]?.WebACLId, '');
  });
});
