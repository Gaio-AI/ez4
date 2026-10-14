import type { EntryState, EntryStates } from '@ez4/state';
import type { AgentNamespaceParameters, AgentNamespaceState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData } from '@ez4/utils';
import { AgentNamespaceServiceType } from './types';

export const createAgentNamespaceStateId = (namespaceName: string) => {
  return hashData(AgentNamespaceServiceType, namespaceName);
};

export const createAgentNamespace = <E extends EntryState>(
  state: EntryStates<E>,
  parameters: AgentNamespaceParameters
): AgentNamespaceState => {
  const entryId = createAgentNamespaceStateId(parameters.namespaceName);

  return attachEntry<E | AgentNamespaceState, AgentNamespaceState>(state, {
    type: AgentNamespaceServiceType,
    entryId,
    dependencies: [],
    parameters
  });
};
