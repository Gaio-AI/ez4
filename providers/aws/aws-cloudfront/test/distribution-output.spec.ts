import type { EntryState } from '@ez4/state';
import type { Arn } from '@ez4/aws-common';
import type { DistributionState } from '../src/distribution/types';

import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { DistributionServiceType } from '../src/distribution/types';
import { resourceOutput } from '../src/triggers/output';

const getDistributionState = (aliases?: string[], deployed = true): DistributionState => {
  return {
    type: DistributionServiceType,
    entryId: 'distribution-entry',
    dependencies: [],
    parameters: {
      distributionName: 'ez4-test-output',
      enabled: true,
      ...(aliases && { aliases }),
      defaultOrigin: {
        id: 'ez4-default',
        domain: 'origin.ez4.test',
        getDistributionOrigin: () => ({ domain: 'origin.ez4.test', cachePolicyId: 'cache', originPolicyId: 'origin' })
      }
    },
    ...(deployed && {
      result: {
        distributionId: 'E000000000000',
        distributionArn: 'arn:aws:cloudfront::000000000000:distribution/E000000000000' as Arn,
        endpoint: 'd111111abcdef8.cloudfront.net',
        originAccessId: 'origin-access-id',
        defaultOrigin: { domain: 'origin.ez4.test', cachePolicyId: 'cache', originPolicyId: 'origin' },
        origins: []
      }
    })
  };
};

describe('cloudfront :: distribution output', () => {
  it('assert :: a deployed distribution outputs its url and every alias', () => {
    const service = getDistributionState(['cdn.ez4.test', 'www.ez4.test']);

    deepEqual(resourceOutput({ service, state: {} }), {
      label: 'ez4-test-output',
      value: 'https://d111111abcdef8.cloudfront.net, https://cdn.ez4.test, https://www.ez4.test'
    });
  });

  it('assert :: a distribution without aliases outputs its cloudfront url', () => {
    const service = getDistributionState();

    deepEqual(resourceOutput({ service, state: {} }), {
      label: 'ez4-test-output',
      value: 'https://d111111abcdef8.cloudfront.net'
    });
  });

  it('assert :: a distribution not deployed yet outputs nothing', () => {
    equal(resourceOutput({ service: getDistributionState(['cdn.ez4.test'], false), state: {} }), null);
  });

  it('assert :: other resources output nothing', () => {
    const service = { type: 'aws:other', entryId: 'other', dependencies: [], parameters: {} } as EntryState;

    equal(resourceOutput({ service, state: {} }), null);
  });
});
