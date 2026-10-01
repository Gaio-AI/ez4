import type { EntryStates } from '@ez4/state';
import type { GatewayState } from '../../gateway/types';

import { Logger } from '@ez4/logger';

import { isIntegrationState } from '../../integration/utils';
import { IntegrationLimitError } from '../errors';

// API Gateway takes at most 300 integrations per HTTP API and the quota cannot be raised. Crossing it fails
// the deploy halfway through the apply, so the check runs while the resources are prepared, before the plan.
const IntegrationLimit = 300;

// Close enough to the limit for moving routes to another API to be planned before a deploy fails.
const IntegrationWarning = 280;

export const assertIntegrationLimit = (state: EntryStates, gatewayState: GatewayState) => {
  const { gatewayName } = gatewayState.parameters;

  let integrations = 0;

  for (const entryId in state) {
    const entry = state[entryId];

    if (entry && isIntegrationState(entry) && entry.dependencies.includes(gatewayState.entryId)) {
      integrations++;
    }
  }

  if (integrations > IntegrationLimit) {
    throw new IntegrationLimitError(gatewayName, integrations, IntegrationLimit);
  }

  if (integrations >= IntegrationWarning) {
    Logger.warn(`API '${gatewayName}' has ${integrations} of the ${IntegrationLimit} integrations API Gateway takes per HTTP API.`);
  }

  return integrations;
};
