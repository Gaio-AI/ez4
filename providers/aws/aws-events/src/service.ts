import type { EntryState, EntryStates } from '@ez4/state';
import type { FunctionState } from '@ez4/aws-function';
import type { EventsRuleParameters, EventsRuleState } from './types';
import { attachEntry } from '@ez4/state';
import { hashData } from '@ez4/utils';
import { EventsRuleServiceType } from './types';

export const createEventsRuleStateId = (name: string) => hashData(EventsRuleServiceType, name);

export const createEventsRule = <E extends EntryState>(
  state: EntryStates<E>,
  functionState: FunctionState,
  parameters: Omit<EventsRuleParameters, 'targetId'>
): EventsRuleState =>
  attachEntry<E | EventsRuleState, EventsRuleState>(state, {
    type: EventsRuleServiceType,
    entryId: createEventsRuleStateId(parameters.name),
    dependencies: [functionState.entryId],
    parameters: { ...parameters, targetId: functionState.entryId }
  });
