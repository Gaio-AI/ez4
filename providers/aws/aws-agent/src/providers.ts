import { registerTriggers as registerEcrTriggers } from '@ez4/aws-ecr';
import { registerTriggers as registerEcsTriggers } from '@ez4/aws-ecs';
import { registerTriggers as registerCloudMapTriggers } from '@ez4/aws-cloudmap';
import { registerTriggers as registerEfsTriggers } from '@ez4/aws-efs';
import { registerTriggers as registerEventsTriggers } from '@ez4/aws-events';
import { registerTriggers as registerSecretTriggers } from '@ez4/aws-secret';

export const registerAgentProviders = () => {
  registerEcrTriggers();
  registerEcsTriggers();
  registerCloudMapTriggers();
  registerEfsTriggers();
  registerEventsTriggers();
  registerSecretTriggers();
};
