import type { AnyObject } from '@ez4/utils';
import type { EmulatorLinkedServices, EmulatorServiceClients } from './types';
import type { ServiceNameOptions } from '../utils/service';
import type { ServiceEmulators } from './service';

import { isAnyString } from '@ez4/utils';

import { getServiceName } from '../utils/service';
import { getCurrentInvocation } from './invocation';

export const makeEmulatorClients = (
  linkedServices: EmulatorLinkedServices,
  linkedOptions: AnyObject | undefined,
  emulators: ServiceEmulators,
  options: ServiceNameOptions
) => {
  const allClients: EmulatorServiceClients = {};

  for (const linkedServiceName in linkedServices) {
    const { reference: resourceName, options: resourceOptions } = linkedServices[linkedServiceName];

    const resourceClient = makeEmulatorClient(resourceName, resourceOptions, linkedOptions, emulators, options);

    allClients[linkedServiceName] = resourceClient;
  }

  return allClients;
};

export const makeEmulatorClient = (
  resourceName: string,
  resourceOptions: AnyObject | undefined,
  linkedOptions: AnyObject | undefined,
  emulators: ServiceEmulators,
  options: ServiceNameOptions
) => {
  const serviceName = getServiceName(resourceName, options);
  const serviceEmulator = emulators[serviceName];

  if (!serviceEmulator) {
    throw new Error(`Service '${resourceName}' has no emulators.`);
  }

  const serviceClient = serviceEmulator.exportHandler?.({
    ...(serviceEmulator.inheritOptions && linkedOptions),
    ...serviceEmulator.options,
    ...resourceOptions
  });

  if (!serviceClient) {
    throw new Error(`Service '${resourceName}' has no client emulator.`);
  }

  return serviceClient;
};

export const makeLazyClients = (
  clients: EmulatorServiceClients,
  linkedServices: EmulatorLinkedServices,
  options: ServiceNameOptions,
  overrides?: EmulatorServiceClients
) => {
  return new Proxy(clients, {
    get: (target, property) => {
      if (!isAnyString(property) || !(property in target)) {
        if (property !== 'then') {
          throw new Error(`Context service '${property.toString()}' not found.`);
        }

        return undefined;
      }

      if (overrides && property in overrides) {
        return overrides[property];
      }

      // The client of the current invocation stays out of the cache, so it's gone once the invocation ends.
      const invocationClient = getInvocationClient(linkedServices[property].reference, options);

      if (invocationClient !== undefined) {
        return invocationClient;
      }

      if (target[property] instanceof Function) {
        target[property] = target[property]();
      }

      return target[property];
    }
  });
};

export const getInvocationClient = (resourceName: string, options: ServiceNameOptions) => {
  const invocation = getCurrentInvocation();

  return invocation?.services[getServiceName(resourceName, options)];
};
