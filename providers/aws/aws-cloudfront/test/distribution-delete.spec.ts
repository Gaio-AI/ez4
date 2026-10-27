import type { DistributionConfig } from '@aws-sdk/client-cloudfront';
import type { StepContext } from '@ez4/state';
import type { Arn } from '@ez4/aws-common';
import type { DistributionState } from '../src/distribution/types';

import { afterEach, describe, it, mock } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { CloudFrontClient, DeleteDistributionCommand, GetDistributionCommand, UpdateDistributionCommand } from '@aws-sdk/client-cloudfront';

import { getDistributionHandler } from '../src/distribution/handler';
import { DistributionServiceType } from '../src/distribution/types';

const CERTIFICATE_ARN = 'arn:aws:acm:us-east-1:000000000000:certificate/a1b2c3d4-0000-1111-2222-333344445555' as Arn;
const REWRITE_FUNCTION_ARN = 'arn:aws:cloudfront::000000000000:function/ez4-test-rewrite' as Arn;

const distribution = {
  Id: 'E000000000000',
  ARN: 'arn:aws:cloudfront::000000000000:distribution/E000000000000' as Arn,
  DomainName: 'ez4.cloudfront.net',
  Status: 'Deployed'
};

const originData = {
  domain: 'origin.ez4.test',
  cachePolicyId: 'cache-policy-id',
  originPolicyId: 'origin-policy-id'
};

// Answers every call like a deployed distribution and keeps what each update and delete sent.
const mockCloudFront = () => {
  const updates: DistributionConfig[] = [];
  const deletes: string[] = [];

  mock.method(CloudFrontClient.prototype, 'send', async (command: unknown) => {
    if (command instanceof UpdateDistributionCommand) {
      updates.push(command.input.DistributionConfig!);
    }

    if (command instanceof DeleteDistributionCommand) {
      deletes.push(command.input.Id!);
    }

    if (command instanceof GetDistributionCommand) {
      return {
        ETag: 'etag',
        Distribution: {
          ...distribution,
          DistributionConfig: {}
        }
      };
    }

    return {
      Distribution: distribution
    };
  });

  return { updates, deletes };
};

const getDistributionState = (): DistributionState => {
  return {
    type: DistributionServiceType,
    entryId: 'distribution-entry',
    dependencies: [],
    parameters: {
      distributionName: 'ez4-test-delete',
      aliases: ['cdn.ez4.test'],
      enabled: true,
      defaultOrigin: {
        id: 'ez4-default',
        domain: originData.domain,
        rewrite: true,
        getDistributionOrigin: () => originData
      }
    },
    result: {
      distributionId: distribution.Id,
      distributionArn: distribution.ARN,
      endpoint: distribution.DomainName,
      originAccessId: 'origin-access-id',
      rewriteFunctionArn: REWRITE_FUNCTION_ARN,
      certificateArn: CERTIFICATE_ARN,
      defaultOrigin: originData,
      origins: []
    }
  };
};

describe('cloudfront :: distribution delete', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: disabling an aliased distribution keeps its certificate and rewrite function', async () => {
    const { updates, deletes } = mockCloudFront();

    await getDistributionHandler().delete(getDistributionState(), {} as StepContext);

    equal(updates.length, 1);

    const [disabled] = updates;

    equal(disabled?.Enabled, false);
    equal(disabled?.Aliases?.Items?.[0], 'cdn.ez4.test');
    equal(disabled?.ViewerCertificate?.ACMCertificateArn, CERTIFICATE_ARN);
    equal(disabled?.ViewerCertificate?.CloudFrontDefaultCertificate, false);

    const associations = disabled?.DefaultCacheBehavior?.FunctionAssociations?.Items ?? [];

    ok(associations.some(({ FunctionARN }) => FunctionARN === REWRITE_FUNCTION_ARN));

    equal(deletes[0], distribution.Id);
  });
});
