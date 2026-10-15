import { registerTriggers as registerAwsTriggers, tryRegisterProvider } from '@ez4/aws-common';
import { getNamespaceHandler } from '../namespace/handler';
import { NamespaceServiceType } from '../namespace/types';

export const registerTriggers = () => {
  registerAwsTriggers();
  tryRegisterProvider(NamespaceServiceType, getNamespaceHandler());
};
