import type { AnyObject } from '@ez4/utils';
import type { ServiceEmulators } from './service';
import type { EmulatorExportHandler, EmulatorRequestEvent, EmulatorServiceClients } from './types';
import type { ServiceMetadata } from '../types/service';

import { isAnyString } from '@ez4/utils';

import { getServiceName } from '../utils/service';
import { EmulatorClientNotFoundError, EmulatorNotFoundError, EmulatorRequestHandlerNotFoundError } from './errors';
import { makeEmulatorClients, makeLazyClients } from './clients';
import { runWithInvocation } from './invocation';

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

  export type Request = {
    /**
     * Request method, `POST` when omitted.
     */
    method?: string;

    /**
     * Request path within the resource, `/` when omitted.
     */
    path?: string;

    headers?: Record<string, string>;

    query?: Record<string, string>;

    /**
     * An object goes as JSON, with `content-type: application/json` unless the headers give another one.
     */
    body?: AnyObject | string | Buffer;
  };

  export type RequestOptions = {
    /**
     * Client of each resource, by resource name, for everything the request runs in its async context.
     */
    services?: Record<string, unknown>;

    /**
     * Identity for a gateway route behind an authorizer, which then doesn't run.
     */
    identity?: AnyObject;
  };

  export type Response = {
    status: number;
    headers: Record<string, string>;
    body?: Buffer | string;
  };

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

  /**
   * Send a request to the emulator of the given resource, the way `ez4 serve` hands it one, and resolve with its
   * response (204 when it gives none). An error the emulator doesn't turn into a response rejects the request.
   *
   * The clients in `options.services` take the place of the real or mocked clients of those resources for whatever
   * runs in the async context of this call: the handler it reaches and the handlers that run from it in the same
   * process, like the Lambda subscriptions of a topic it publishes to or the target of a schedule event it creates,
   * even after this call resolves. What resolves a client out of that context gets the usual one.
   *
   * A queue delivers its messages out of that context: the consumer of a message sent during the call gets the
   * usual clients, since its batch can carry messages from other tests. A topic's queue subscription sends to the
   * queue client of the call, which is the given one when that queue is overridden, and its consumer runs out of the
   * context all the same.
   */
  export const request = async (resourceName: string, request: Request, options?: RequestOptions): Promise<Response> => {
    if (!ensureContext(CONTEXT)) {
      throw new Error('Tester is not configured yet.');
    }

    const serviceName = getServiceName(resourceName, CONTEXT.options);
    const serviceEmulator = CONTEXT.emulators[serviceName];

    if (!serviceEmulator) {
      throw new EmulatorNotFoundError(resourceName);
    }

    const { requestHandler } = serviceEmulator;

    if (!requestHandler) {
      throw new EmulatorRequestHandlerNotFoundError(resourceName);
    }

    const invocation = {
      services: getInvocationServices(CONTEXT, options?.services),
      identity: options?.identity
    };

    const response = await runWithInvocation(invocation, () => {
      return requestHandler(getRequestEvent(request));
    });

    if (!response) {
      return {
        status: 204,
        headers: {}
      };
    }

    const { status, headers = {}, body } = response;

    if (body === undefined) {
      return {
        status,
        headers
      };
    }

    return {
      status,
      headers,
      body
    };
  };

  /**
   * Get the context the handlers of the given service receive: a client for each service it links, made the way the
   * emulator makes them. A client in `overrides`, by context name, takes the place of the linked one.
   */
  export const getContext = <T extends object = EmulatorServiceClients>(resourceName: string, overrides?: Partial<T>): T => {
    if (!ensureContext(CONTEXT)) {
      throw new Error('Tester is not configured yet.');
    }

    const serviceName = getServiceName(resourceName, CONTEXT.options);
    const serviceEmulator = CONTEXT.emulators[serviceName];

    if (!serviceEmulator) {
      throw new EmulatorNotFoundError(resourceName);
    }

    const linkedServices = serviceEmulator.service?.services ?? {};
    const contextOverrides = Object.fromEntries(Object.entries(overrides ?? {}));

    for (const contextName in contextOverrides) {
      if (!(contextName in linkedServices)) {
        throw new Error(`Context service '${contextName}' not found.`);
      }
    }

    const serviceClients = makeEmulatorClients(linkedServices, undefined, CONTEXT.emulators, CONTEXT.options);

    return makeLazyClients(serviceClients, linkedServices, CONTEXT.options, contextOverrides) as T;
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

const getInvocationServices = (context: Required<TesterContext>, services: Record<string, unknown> = {}) => {
  const invocationServices: Record<string, unknown> = {};

  for (const resourceName in services) {
    const serviceName = getServiceName(resourceName, context.options);

    if (!context.emulators[serviceName]) {
      throw new EmulatorNotFoundError(resourceName);
    }

    invocationServices[serviceName] = services[resourceName];
  }

  return invocationServices;
};

const getRequestEvent = (request: Tester.Request): EmulatorRequestEvent => {
  const headers: Record<string, string> = {};

  // An HTTP server gives the emulators lowercase header names.
  for (const headerName in request.headers) {
    headers[headerName.toLowerCase()] = request.headers[headerName];
  }

  return {
    method: request.method ?? 'POST',
    path: request.path ?? '/',
    query: { ...request.query },
    headers,
    body: getRequestBody(request.body, headers)
  };
};

const getRequestBody = (body: Tester.Request['body'], headers: Record<string, string>) => {
  if (body === undefined || Buffer.isBuffer(body)) {
    return body;
  }

  if (isAnyString(body)) {
    return Buffer.from(body);
  }

  headers['content-type'] ??= 'application/json';

  return Buffer.from(JSON.stringify(body));
};
