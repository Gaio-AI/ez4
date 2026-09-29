import type { AnyObject } from '@ez4/utils';
import type { ServiceEmulators } from './service';
import type { EmulatorExportHandler } from './types';
import type { ServiceMetadata } from '../types/service';

import { getServiceName } from '../utils/service';
import { EmulatorClientNotFoundError, EmulatorNotFoundError } from './errors';

type TesterContext = {
  originals?: Record<string, EmulatorExportHandler | undefined>;
  emulators?: ServiceEmulators;
  options?: TesterOptions;
};

type TesterOptions = {
  prefix: string;
  projectName: string;
  branchName: string;
};

export namespace Tester {
  const CONTEXT: TesterContext = {};

  const ensureContext = (context: TesterContext): context is Required<TesterContext> => {
    return !!context.options && !!context.emulators;
  };

  export type Options = TesterOptions;

  export const configure = (emulators: ServiceEmulators, options: Options) => {
    if (CONTEXT.emulators) {
      throw new Error('Tester is already configured.');
    }

    Object.assign(CONTEXT, {
      originals: {},
      emulators,
      options
    });
  };

  export const getServiceClient = (resourceName: string, resourceOptions?: AnyObject): unknown => {
    if (!ensureContext(CONTEXT)) {
      throw new Error('Tester is not configured yet.');
    }

    const serviceName = getServiceName(resourceName, CONTEXT.options);
    const serviceEmulator = CONTEXT.emulators[serviceName];

    if (!serviceEmulator) {
      throw new EmulatorNotFoundError(resourceName);
    }

    if (!serviceEmulator.exportHandler) {
      throw new EmulatorClientNotFoundError(resourceName);
    }

    const serviceClient = serviceEmulator.exportHandler(resourceOptions ?? {});

    if (serviceClient instanceof Function) {
      return serviceClient();
    }

    return serviceClient;
  };

  // Unlike its siblings it doesn't throw: a mock falls back to not checking what it can't find a contract for.
  export const getServiceMetadata = (resourceName: string): ServiceMetadata | undefined => {
    if (!ensureContext(CONTEXT)) {
      return undefined;
    }

    const serviceName = getServiceName(resourceName, CONTEXT.options);

    return CONTEXT.emulators[serviceName]?.service;
  };

  export const mockServiceClient = (resourceName: string, client: unknown) => {
    if (!ensureContext(CONTEXT)) {
      throw new Error('Tester is not configured yet.');
    }

    const serviceName = getServiceName(resourceName, CONTEXT.options);
    const serviceEmulator = CONTEXT.emulators[serviceName];

    if (!serviceEmulator) {
      throw new EmulatorNotFoundError(resourceName);
    }

    // Only the handler from before the first mock is kept, so a mock over a mock still restores the real client.
    if (!(serviceName in CONTEXT.originals)) {
      CONTEXT.originals[serviceName] = serviceEmulator.exportHandler;
    }

    CONTEXT.emulators[serviceName] = {
      ...serviceEmulator,
      exportHandler: () => client
    };
  };

  export const restoreServiceClient = (resourceName: string) => {
    if (!ensureContext(CONTEXT)) {
      throw new Error('Tester is not configured yet.');
    }

    const serviceName = getServiceName(resourceName, CONTEXT.options);
    const serviceEmulator = CONTEXT.emulators[serviceName];

    if (!serviceEmulator) {
      throw new EmulatorNotFoundError(resourceName);
    }

    // Restoring a client that was never mocked would drop its real handler.
    if (!(serviceName in CONTEXT.originals)) {
      return;
    }

    CONTEXT.emulators[serviceName] = {
      ...serviceEmulator,
      exportHandler: CONTEXT.originals[serviceName]
    };

    delete CONTEXT.originals[serviceName];
  };
}
