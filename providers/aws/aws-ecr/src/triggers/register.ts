import { registerTriggers as registerAwsTriggers, tryRegisterProvider } from '@ez4/aws-common';
import { EcrRepositoryServiceType } from '../repository/types';
import { getEcrRepositoryHandler } from '../repository/handler';
import { EcrImageServiceType } from '../image/state';
import { getEcrImageHandler } from '../image/image-handler';

export const registerTriggers = () => {
  registerAwsTriggers();
  tryRegisterProvider(EcrRepositoryServiceType, getEcrRepositoryHandler());
  tryRegisterProvider(EcrImageServiceType, getEcrImageHandler());
};
