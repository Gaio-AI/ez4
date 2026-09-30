import type { EmulateServiceContext, ServeOptions, ServiceEmulator } from '@ez4/project/library';
import type { BucketService } from '@ez4/storage/library';
import type { Client } from '@ez4/storage';

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { registerTriggers as registerStorageTriggers } from '@ez4/local-storage';
import { getServiceName, triggerAllAsync } from '@ez4/project/library';
import { toKebabCase } from '@ez4/utils';

export type ServiceEmulators = Record<string, ServiceEmulator>;

/**
 * Emulate context resolving clients the way `ez4 serve` does: by the emulator of the linked resource.
 */
export const createEmulateContext = (emulators: ServiceEmulators, options: ServeOptions): EmulateServiceContext => {
  return {
    makeClients: () => ({}),
    makeClient: (resourceName: string) => {
      const emulator = emulators[getServiceName(resourceName, options)];

      if (!emulator?.exportHandler) {
        throw new Error(`Service '${resourceName}' has no emulators.`);
      }

      return emulator.exportHandler({});
    }
  };
};

/**
 * Remove the files the local storage emulator keeps for the given bucket.
 */
export const removeLocalBucket = (bucketName: string) => {
  return rm(join('.ez4', toKebabCase(bucketName)), {
    recursive: true,
    force: true
  });
};

/**
 * Register a bucket through the local storage emulator (starting empty) and return its client.
 */
export const createLocalBucket = async (bucketName: string, emulators: ServiceEmulators, options: ServeOptions) => {
  registerStorageTriggers();

  await removeLocalBucket(bucketName);

  const service: BucketService = {
    type: '@ez4/bucket',
    name: bucketName,
    context: {},
    variables: {},
    services: {}
  };

  const emulator = await triggerAllAsync('emulator:getServices', (handler) => {
    return handler({
      context: createEmulateContext(emulators, options),
      service,
      options
    });
  });

  if (!emulator?.exportHandler) {
    throw new Error(`Bucket '${bucketName}' has no storage emulator.`);
  }

  emulators[emulator.identifier] = emulator;

  return emulator.exportHandler({}) as Client;
};
