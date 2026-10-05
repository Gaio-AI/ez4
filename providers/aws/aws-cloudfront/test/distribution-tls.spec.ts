import type { DistributionConfig } from '@aws-sdk/client-cloudfront';
import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { CdnService } from '@ez4/distribution/library';
import type { EntryStates, StepContext } from '@ez4/state';
import type { Arn, OperationLogLine } from '@ez4/aws-common';
import type { CreateRequest } from '../src/distribution/client';
import type { DistributionParameters, DistributionState } from '../src/distribution/types';

import { afterEach, describe, it, mock } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import {
  CloudFrontClient,
  CreateDistributionWithTagsCommand,
  GetDistributionCommand,
  UpdateDistributionCommand
} from '@aws-sdk/client-cloudfront';

import { CdnOriginType } from '@ez4/distribution/library';
import { CertificateServiceType } from '@ez4/aws-certificate';
import { isDistributionState } from '@ez4/aws-cloudfront';

import { createDistribution } from '../src/distribution/client';
import { getDistributionHandler } from '../src/distribution/handler';
import { DistributionServiceType } from '../src/distribution/types';
import { AccessServiceType } from '../src/access/types';
import { prepareCdnServices } from '../src/triggers/service';

const CERTIFICATE_ARN = 'arn:aws:acm:us-east-1:000000000000:certificate/a1b2c3d4-0000-1111-2222-333344445555';

const logger: OperationLogLine = {
  update: () => {}
};

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

const request: CreateRequest = {
  distributionName: 'ez4-test-tls',
  enabled: true,
  defaultOrigin: {
    id: 'ez4-default',
    ...originData
  }
};

// Answers every call like a deployed distribution and keeps the configuration each create or update sent.
const mockCloudFront = () => {
  const sentConfigs: DistributionConfig[] = [];

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
          DistributionConfig: {}
        }
      };
    }

    return {
      Distribution: distribution
    };
  });

  return sentConfigs;
};

const getService = (attributes: Partial<CdnService>) => {
  return {
    type: '@ez4/cdn',
    name: 'TlsCdn',
    context: {},
    aliases: [],
    defaultOrigin: {
      type: CdnOriginType.Regular,
      domain: 'origin.ez4.test'
    },
    ...attributes
  } as CdnService;
};

const getDistributionParameters = (service: CdnService) => {
  const state: EntryStates = {};

  const options = {
    prefix: 'ez4',
    projectName: 'tls',
    branchName: ''
  } as DeployOptions;

  const context = {
    getServiceState: () => {
      throw new Error('No service state.');
    },
    setServiceState: () => {}
  } as unknown as EventContext;

  prepareCdnServices({ state, service, options, context });

  const [distributionState] = Object.values(state).filter((entry) => entry && isDistributionState(entry));

  ok(distributionState && isDistributionState(distributionState));

  return distributionState.parameters;
};

const getDistributionState = (parameters: Partial<DistributionParameters>): DistributionState => {
  return {
    type: DistributionServiceType,
    entryId: 'distribution-entry',
    dependencies: [],
    parameters: {
      distributionName: request.distributionName,
      enabled: true,
      defaultOrigin: {
        id: 'ez4-default',
        domain: originData.domain,
        getDistributionOrigin: () => originData
      },
      ...parameters
    },
    result: {
      distributionId: distribution.Id,
      distributionArn: distribution.ARN,
      endpoint: distribution.DomainName,
      originAccessId: 'origin-access-id',
      certificateArn: CERTIFICATE_ARN,
      defaultOrigin: originData,
      origins: []
    }
  };
};

const stepContext = {
  force: false,
  getDependencies: (type: string) => {
    switch (type) {
      case AccessServiceType:
        return [{ result: { accessId: 'origin-access-id' } }];

      case CertificateServiceType:
        return [{ result: { certificateArn: CERTIFICATE_ARN } }];

      default:
        return [];
    }
  }
} as unknown as StepContext;

describe('cloudfront :: distribution tls', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: a service with a certificate asks for tls 1.2 at least', () => {
    const parameters = getDistributionParameters(getService({ certificate: { domain: 'cdn.ez4.test' } }));

    equal(parameters.minimumProtocolVersion, 'TLSv1.2_2021');
  });

  it('assert :: a service on the default certificate leaves the distribution parameters as they were', () => {
    // CloudFront holds the default certificate to TLSv1 whatever the request says, and a new key would show
    // up as a change in the plan of existing distributions.
    ok(!('minimumProtocolVersion' in getDistributionParameters(getService({}))));
  });

  it('assert :: create sends the minimum protocol version', async () => {
    const sentConfigs = mockCloudFront();

    await createDistribution(logger, {
      ...request,
      certificateArn: CERTIFICATE_ARN,
      minimumProtocolVersion: 'TLSv1.2_2021'
    });

    equal(sentConfigs[0]?.ViewerCertificate?.MinimumProtocolVersion, 'TLSv1.2_2021');
  });

  it('assert :: create on the default certificate keeps TLSv1', async () => {
    const sentConfigs = mockCloudFront();

    await createDistribution(logger, request);

    equal(sentConfigs[0]?.ViewerCertificate?.MinimumProtocolVersion, 'TLSv1');
  });

  it('assert :: a custom origin is reached over tls 1.2', async () => {
    const sentConfigs = mockCloudFront();

    await createDistribution(logger, request);

    deepEqual(sentConfigs[0]?.Origins?.Items?.[0]?.CustomOriginConfig?.OriginSslProtocols, {
      Quantity: 1,
      Items: ['TLSv1.2']
    });
  });

  it('assert :: an existing distribution gets the minimum protocol version on its next deploy', async () => {
    const sentConfigs = mockCloudFront();

    const current = getDistributionState({});
    const candidate = getDistributionState({ minimumProtocolVersion: 'TLSv1.2_2021' });

    await getDistributionHandler().update(candidate, current, stepContext);

    equal(sentConfigs.length, 1);
    equal(sentConfigs[0]?.ViewerCertificate?.MinimumProtocolVersion, 'TLSv1.2_2021');
  });

  it('assert :: a distribution already on the minimum protocol version is not updated again', async () => {
    const sentConfigs = mockCloudFront();

    const current = getDistributionState({ minimumProtocolVersion: 'TLSv1.2_2021' });
    const candidate = getDistributionState({ minimumProtocolVersion: 'TLSv1.2_2021' });

    await getDistributionHandler().update(candidate, current, stepContext);

    equal(sentConfigs.length, 0);
  });
});
