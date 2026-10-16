import { registerTriggers as registerAwsTriggers, tryRegisterProvider } from '@ez4/aws-common';
import { EcsClusterServiceType } from '../cluster/types';
import { getEcsClusterHandler } from '../cluster/handler';
import { EcsTaskDefServiceType } from '../taskdef/types';
import { getEcsTaskDefHandler } from '../taskdef/handler';
import { EcsServiceServiceType } from '../service/types';
import { getEcsServiceHandler } from '../service/handler';

export const registerTriggers = () => {
  registerAwsTriggers();
  tryRegisterProvider(EcsClusterServiceType, getEcsClusterHandler());
  tryRegisterProvider(EcsTaskDefServiceType, getEcsTaskDefHandler());
  tryRegisterProvider(EcsServiceServiceType, getEcsServiceHandler());
};
