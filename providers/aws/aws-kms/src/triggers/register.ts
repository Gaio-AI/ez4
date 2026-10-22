import type { PrepareResourceEvent } from '@ez4/project/library';

import { registerTriggers as registerAwsTriggers } from '@ez4/aws-common';
import { registerTriggers as registerAwsIdentityTriggers } from '@ez4/aws-identity';
import { registerTriggers as registerEncryptionTriggers } from '@ez4/encryption/library';
import { tryCreateTrigger } from '@ez4/project/library';

import { registerKeyProvider } from '../key/provider';
import { prepareImports, prepareLinkedServices, prepareServices } from './deploy';
import { prepareExecutionPolicy } from './policy';
import { createEmulatorClient } from './emulator';

export const registerTriggers = () => {
  registerAwsTriggers();
  registerAwsIdentityTriggers();
  registerEncryptionTriggers();

  tryCreateTrigger('@ez4/aws-kms', {
    'deploy:prepareExecutionPolicy': prepareExecutionPolicy,
    'deploy:prepareLinkedService': prepareLinkedServices,
    'deploy:prepareResources': prepareKmsResources,
    'emulator:clientFactory': createEmulatorClient
  });

  registerKeyProvider();
};

const prepareKmsResources = (event: PrepareResourceEvent) => {
  return prepareServices(event) || prepareImports(event);
};
