import { registerTriggers as registerAwsTriggers, tryRegisterProvider } from '@ez4/aws-common';
import { getEventsRuleHandler } from '../handler';
import { EventsRuleServiceType } from '../types';

export const registerTriggers = () => {
  registerAwsTriggers();
  tryRegisterProvider(EventsRuleServiceType, getEventsRuleHandler());
};
