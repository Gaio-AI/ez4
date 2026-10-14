import type { EntryState, EntryStates } from '@ez4/state';
import type { ProxyServiceParameters, ProxyServiceState } from './ecs-types';

import { attachEntry } from '@ez4/state';
import { hashData } from '@ez4/utils';
import { ProxyServiceServiceType } from './ecs-types';

export const createProxyServiceStateId = (serviceName: string) => {
  return hashData(ProxyServiceServiceType, serviceName);
};

export const createProxyService = <E extends EntryState>(
  state: EntryStates<E>,
  parameters: ProxyServiceParameters,
  dependencies: string[] = []
): ProxyServiceState => {
  const entryId = createProxyServiceStateId(parameters.serviceName);

  return attachEntry<E | ProxyServiceState, ProxyServiceState>(state, {
    type: ProxyServiceServiceType,
    entryId,
    dependencies,
    parameters
  });
};
