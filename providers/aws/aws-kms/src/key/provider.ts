import { tryRegisterProvider } from '@ez4/aws-common';

import { getKeyHandler } from './handler';
import { KeyServiceType } from './types';

export const registerKeyProvider = () => {
  tryRegisterProvider(KeyServiceType, getKeyHandler());
};
