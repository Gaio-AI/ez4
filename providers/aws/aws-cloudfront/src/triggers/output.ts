import type { ResourceOutputEvent } from '@ez4/project/library';

import { isDistributionState } from '../distribution/utils';

export const resourceOutput = (event: ResourceOutputEvent) => {
  const { service } = event;

  if (!isDistributionState(service)) {
    return null;
  }

  const { parameters, result } = service;

  if (!result) {
    return null;
  }

  const domains = [result.endpoint, ...(parameters.aliases ?? [])];

  return {
    label: parameters.distributionName,
    value: domains.map((domain) => `https://${domain}`).join(', ')
  };
};
