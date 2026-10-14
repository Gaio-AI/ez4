import { registerTriggers as registerAgentTriggers } from '@ez4/agent/library';
import { registerTriggers as registerAwsTriggers } from '@ez4/aws-common';
import { registerTriggers as registerAwsIdentityTriggers } from '@ez4/aws-identity';
import { registerTriggers as registerAwsFunctionTriggers } from '@ez4/aws-function';
import { registerTriggers as registerAwsBucketTriggers } from '@ez4/aws-bucket';
import { registerTriggers as registerAwsLogsTriggers } from '@ez4/aws-logs';
import { tryCreateTrigger } from '@ez4/project/library';

import { registerAgentProviders } from '../providers';
import { prepareLinkedService } from './client';
import { prepareIdentityAccount } from './identity';
import { prepareExecutionPolicy } from './policy';
import { connectAgentResources, prepareAgentResources } from './resources';

export const registerTriggers = () => {
  registerAwsTriggers();
  registerAwsIdentityTriggers();
  registerAwsFunctionTriggers();
  registerAwsBucketTriggers();
  registerAwsLogsTriggers();
  registerAgentTriggers();

  tryCreateTrigger('@ez4/aws-agent', {
    'deploy:prepareIdentityAccount': prepareIdentityAccount,
    'deploy:prepareExecutionPolicy': prepareExecutionPolicy,
    'deploy:prepareLinkedService': prepareLinkedService,
    'deploy:prepareResources': prepareAgentResources,
    'deploy:connectResources': connectAgentResources
  });

  registerAgentProviders();
};
