import type { EntryStates } from '@ez4/state';

import { afterEach, describe, it, mock } from 'node:test';
import { equal, throws } from 'node:assert/strict';

import { Logger } from '@ez4/logger';

import { IntegrationLimitError } from '../src/triggers/errors';
import { assertIntegrationLimit } from '../src/triggers/http/limits';
import { IntegrationServiceType } from '../src/integration/types';
import { createGateway } from '../src/gateway/service';
import { GatewayProtocol } from '../src/gateway/types';

const getGatewayState = (integrations: number) => {
  const state: EntryStates = {};

  const gatewayState = createGateway(state, {
    gatewayId: 'ez4-test-integration-limit',
    gatewayName: 'Integration Limit',
    protocol: GatewayProtocol.Http
  });

  for (let index = 0; index < integrations; index++) {
    const entryId = `integration-${index}`;

    state[entryId] = {
      type: IntegrationServiceType,
      dependencies: [gatewayState.entryId, `function-${index}`],
      parameters: {},
      entryId
    };
  }

  // Integrations of another API never count.
  for (let index = 0; index < 10; index++) {
    const entryId = `other-integration-${index}`;

    state[entryId] = {
      type: IntegrationServiceType,
      dependencies: ['other-gateway', `other-function-${index}`],
      parameters: {},
      entryId
    };
  }

  return { state, gatewayState };
};

describe('aws gateway integration limit', () => {
  const warn = mock.method(Logger, 'warn', () => {});

  afterEach(() => {
    warn.mock.resetCalls();
  });

  it('assert :: an api far from the limit is quiet', () => {
    const { state, gatewayState } = getGatewayState(279);

    equal(assertIntegrationLimit(state, gatewayState), 279);
    equal(warn.mock.callCount(), 0);
  });

  it('assert :: an api close to the limit warns', () => {
    const { state, gatewayState } = getGatewayState(280);

    equal(assertIntegrationLimit(state, gatewayState), 280);
    equal(warn.mock.callCount(), 1);
  });

  it('assert :: an api at the limit still deploys', () => {
    const { state, gatewayState } = getGatewayState(300);

    equal(assertIntegrationLimit(state, gatewayState), 300);
  });

  it('assert :: an api over the limit stops the deploy', () => {
    const { state, gatewayState } = getGatewayState(301);

    throws(() => assertIntegrationLimit(state, gatewayState), IntegrationLimitError);
  });
});
