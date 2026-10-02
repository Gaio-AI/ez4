import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { CdnService } from '@ez4/distribution/library';
import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { CdnOriginType } from '@ez4/distribution/library';
import { isDistributionState } from '@ez4/aws-cloudfront';

import { prepareCdnServices } from '../src/triggers/service';

const FIREWALL_ARN = 'arn:aws:wafv2:us-east-1:000000000000:global/webacl/ez4-test/a1b2c3d4-0000-1111-2222-333344445555';

const options = {
  prefix: 'ez4',
  projectName: 'firewall',
  branchName: ''
} as DeployOptions;

const context = {
  getServiceState: () => {
    throw new Error('No service state.');
  },
  setServiceState: () => {}
} as unknown as EventContext;

const getService = (attributes: Partial<CdnService>) => {
  return {
    type: '@ez4/cdn',
    name: 'FirewallCdn',
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

  prepareCdnServices({ state, service, options, context });

  const [distributionState] = Object.values(state).filter((entry) => entry && isDistributionState(entry));

  ok(distributionState && isDistributionState(distributionState));

  return distributionState.parameters;
};

describe('cdn service firewall', () => {
  it('assert :: a declared firewall goes to the distribution', () => {
    const parameters = getDistributionParameters(getService({ firewall: FIREWALL_ARN }));

    equal(parameters.firewallArn, FIREWALL_ARN);
  });

  it('assert :: a service without firewall leaves the distribution parameters as they were', () => {
    // Any new key, even an undefined one, would show up as a change in the plan of existing distributions.
    ok(!('firewallArn' in getDistributionParameters(getService({}))));
  });
});
