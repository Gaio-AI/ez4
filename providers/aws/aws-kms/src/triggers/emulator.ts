import type { EmulateClientEvent } from '@ez4/project/library';

import { isEncryptionImport, isEncryptionService } from '@ez4/encryption/library';

import { Client } from '../client';
import { getImportedProjectOptions, getKeyAliasName } from './utils';

/**
 * Locally the values are sealed with the emulator key and need no AWS account. Against a real
 * environment the client uses the key that environment deployed.
 */
export const createEmulatorClient = (event: EmulateClientEvent) => {
  const { service, options } = event;

  if (!isEncryptionService(service) && !isEncryptionImport(service)) {
    return null;
  }

  if (options.local) {
    const instance = Client.makeLocal();

    return {
      make: () => instance
    };
  }

  const keyOptions = isEncryptionImport(service) ? getImportedProjectOptions(service, options.imports) : options;

  const instance = Client.make({
    keyId: getKeyAliasName(service, keyOptions)
  });

  return {
    make: () => instance
  };
};
