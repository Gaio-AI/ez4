import { tryRegisterProvider } from '@ez4/aws-common';

import { getEcsClusterHandler } from './cluster/handler';
import { EcsClusterServiceType } from './cluster/types';
import { getEcrRepositoryHandler } from './image/handler';
import { getEcrImageHandler } from './image/image-handler';
import { EcrImageServiceType } from './image/state';
import { EcrRepositoryServiceType } from './image/types';
import { getEcsTaskDefHandler } from './taskdef/handler';
import { EcsTaskDefServiceType } from './taskdef/types';
import { getProxyCredentialHandler } from './proxy/credential';
import { ProxyCredentialServiceType } from './proxy/types';
import { getEventsRuleHandler } from './events/handler';
import { EventsRuleServiceType } from './events/types';

export const registerAgentProviders = () => {
  tryRegisterProvider(EcrRepositoryServiceType, getEcrRepositoryHandler());
  tryRegisterProvider(EcrImageServiceType, getEcrImageHandler());
  tryRegisterProvider(EcsClusterServiceType, getEcsClusterHandler());
  tryRegisterProvider(EcsTaskDefServiceType, getEcsTaskDefHandler());
  tryRegisterProvider(ProxyCredentialServiceType, getProxyCredentialHandler());
  tryRegisterProvider(EventsRuleServiceType, getEventsRuleHandler());
};
