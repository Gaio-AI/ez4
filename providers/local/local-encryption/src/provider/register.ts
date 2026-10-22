import type { EmulateServiceEvent } from '@ez4/project/library';

import { isEncryptionImport, isEncryptionService, registerTriggers as registerEncryptionTriggers } from '@ez4/encryption/library';
import { tryCreateTrigger } from '@ez4/project/library';

import { registerEncryptionEmulator } from './emulator';

export const registerTriggers = () => {
  registerEncryptionTriggers();

  tryCreateTrigger('@ez4/local-encryption', {
    'emulator:getServices': ({ service, options }: EmulateServiceEvent) => {
      if (isEncryptionService(service) || isEncryptionImport(service)) {
        return registerEncryptionEmulator(service, options);
      }

      return null;
    }
  });
};
