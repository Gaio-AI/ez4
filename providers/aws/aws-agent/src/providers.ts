import { tryRegisterProvider } from '@ez4/aws-common';
import { registerTriggers as registerEcrTriggers } from '@ez4/aws-ecr';
import { registerTriggers as registerEcsTriggers } from '@ez4/aws-ecs';

import { getProxyCredentialHandler } from './proxy/credential';
import { ProxyCredentialServiceType } from './proxy/types';
import { getProviderCredentialHandler } from './auth/handler';
import { ProviderCredentialServiceType } from './auth/types';
import { getEventsRuleHandler } from './events/handler';
import { EventsRuleServiceType } from './events/types';
import { getAgentNamespaceHandler } from './namespace/handler';
import { AgentNamespaceServiceType } from './namespace/types';
import { getProxyServiceHandler } from './proxy/ecs-handler';
import { ProxyServiceServiceType } from './proxy/ecs-types';

export const registerAgentProviders = () => {
  registerEcrTriggers();
  registerEcsTriggers();
  tryRegisterProvider(ProxyCredentialServiceType, getProxyCredentialHandler());
  tryRegisterProvider(ProviderCredentialServiceType, getProviderCredentialHandler());
  tryRegisterProvider(EventsRuleServiceType, getEventsRuleHandler());
  tryRegisterProvider(AgentNamespaceServiceType, getAgentNamespaceHandler());
  tryRegisterProvider(ProxyServiceServiceType, getProxyServiceHandler());
};
