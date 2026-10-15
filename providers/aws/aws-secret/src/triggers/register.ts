import { registerTriggers as registerAwsTriggers, tryRegisterProvider } from '@ez4/aws-common';
import { getSecretHandler } from '../handler';
import { SecretServiceType } from '../types';

export const registerTriggers = () => {
  registerAwsTriggers();
  tryRegisterProvider(SecretServiceType, getSecretHandler());
};
