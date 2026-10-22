import type { EncryptionImport, EncryptionService } from '@ez4/encryption/library';
import type { ServeOptions } from '@ez4/project/library';

import { getServiceName, triggerAllAsync } from '@ez4/project/library';

export const registerEncryptionEmulator = async (service: EncryptionService | EncryptionImport, options: ServeOptions) => {
  const clientFactory = await getEncryptionClient(service, options);

  if (!clientFactory) {
    return null;
  }

  return {
    type: 'Encryption',
    name: service.name,
    identifier: getServiceName(service.name, options),
    exportHandler: () => {
      return clientFactory.make();
    }
  };
};

const getEncryptionClient = (service: EncryptionService | EncryptionImport, options: ServeOptions) => {
  return triggerAllAsync('emulator:clientFactory', (handler) =>
    handler({
      service,
      options
    })
  );
};
