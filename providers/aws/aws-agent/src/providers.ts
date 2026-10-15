import { tryRegisterProvider } from '@ez4/aws-common';
import { registerTriggers as registerEcrTriggers } from '@ez4/aws-ecr';
import { registerTriggers as registerEcsTriggers } from '@ez4/aws-ecs';
import { registerTriggers as registerCloudMapTriggers } from '@ez4/aws-cloudmap';
import { registerTriggers as registerEventsTriggers } from '@ez4/aws-events';
import { registerTriggers as registerSecretTriggers } from '@ez4/aws-secret';

import { getProxyServiceHandler } from './proxy/ecs-handler';
import { ProxyServiceServiceType } from './proxy/ecs-types';

export const registerAgentProviders = () => {
  registerEcrTriggers();
  registerEcsTriggers();
  registerCloudMapTriggers();
  registerEventsTriggers();
  registerSecretTriggers();
  tryRegisterProvider(ProxyServiceServiceType, getProxyServiceHandler());
};
