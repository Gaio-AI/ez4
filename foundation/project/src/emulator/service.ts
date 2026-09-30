import type { AnyObject } from '@ez4/utils';
import type { EmulatorLinkedServices, ServiceEmulator, EmulatorServiceClients } from './types';
import type { MetadataReflection } from '../types/metadata';
import type { ServeOptions } from '../types/options';

import { triggerAllAsync } from '@ez4/project/library';
import { hashObject } from '@ez4/utils';

import { getInvocationClient, makeEmulatorClient, makeEmulatorClients, makeLazyClients } from './clients';
import { MissingEmulatorProvider } from './errors';

export type ServiceEmulators = Record<string, ServiceEmulator>;

export const getServiceEmulators = async (metadata: MetadataReflection, options: ServeOptions) => {
  const clientsCache: Record<string, EmulatorServiceClients> = {};
  const emulators: ServiceEmulators = {};

  const context = {
    makeClient: (resourceName: string, resourceOptions?: AnyObject) => {
      return getInvocationClient(resourceName, options) ?? makeEmulatorClient(resourceName, resourceOptions, undefined, emulators, options);
    },
    makeClients: (linkedServices: EmulatorLinkedServices, linkedOptions?: AnyObject) => {
      const clientKey = hashObject({ linkedServices, linkedOptions });

      if (!clientsCache[clientKey]) {
        clientsCache[clientKey] = {};

        const allClients = makeEmulatorClients(linkedServices, linkedOptions, emulators, options);

        Object.assign(clientsCache[clientKey], allClients);
      }

      return makeLazyClients(clientsCache[clientKey], linkedServices, options);
    }
  };

  for (const identity in metadata) {
    const service = metadata[identity];

    const result = await triggerAllAsync('emulator:getServices', (handler) =>
      handler({
        service,
        options,
        context
      })
    );

    if (!result) {
      throw new MissingEmulatorProvider(service.name);
    }

    // Testers read the service contract (schemas, FIFO mode, routes) to make mocks that validate like the real client.
    emulators[result.identifier] = {
      ...result,
      service: result.service ?? service
    };
  }

  return emulators;
};
