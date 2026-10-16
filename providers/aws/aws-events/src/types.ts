import type { EntryState } from '@ez4/state';

export const EventsRuleServiceName = 'AWS:Events/Rule';
export const EventsRuleServiceType = 'aws:events.rule';

export interface EventsRuleParameters {
  name: string;
  targetId: string;
  eventPattern?: string;
  scheduleExpression?: string;
}

export interface EventsRuleResult {
  arn: string;
  targetArn: string;
}

export type EventsRuleState = EntryState & {
  type: typeof EventsRuleServiceType;
  parameters: EventsRuleParameters;
  result?: EventsRuleResult;
};
