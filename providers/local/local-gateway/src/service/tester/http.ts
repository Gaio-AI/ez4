import type { HttpClient, HttpClientResponse, Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { Service } from '@ez4/common';
import type { AnyObject } from '@ez4/utils';
import type { Mock } from 'node:test';
import type { HttpClientMockOperation } from '../../client/http/mock';

import { isHttpImport, isHttpService } from '@ez4/gateway/library';
import { Tester } from '@ez4/project/library';

import { createHttpClientMock } from '../../client/http/mock';

export namespace HttpTester {
  export type MockOptions<T extends Http.Service> = {
    default: HttpClientMockOperation | HttpClientResponse;
    operations?: {
      [P in keyof HttpClient<T>]?: HttpClient<T>[P] | Awaited<ReturnType<HttpClient<T>[P]>>;
    };
  };

  export type ClientMock<T extends Http.Service> = {
    [P in keyof HttpClient<T>]: Mock<HttpClient<T>[P]>;
  };

  export const getClient = <T extends Http.Service>(resourceName: string) => {
    return Tester.getServiceClient(resourceName) as HttpClient<T>;
  };

  /**
   * Get a client mock for the given service. When the tester knows the service, each request is checked the way
   * the service checks it (400 for an invalid body, query or path) and each response body reaches the caller the
   * way the real client delivers it.
   */
  export const getClientMock = <T extends Http.Service>(resourceName: string, options: MockOptions<T>) => {
    return createHttpClientMock(resourceName, options, getHttpContract(resourceName)) as ClientMock<T>;
  };

  export const setClientMock = <T extends Http.Service>(resourceName: string, options: MockOptions<T>) => {
    const client = getClientMock<T>(resourceName, options);

    Tester.mockServiceClient(resourceName, client);

    return client;
  };

  export const restoreClient = (resourceName: string) => {
    Tester.restoreServiceClient(resourceName);
  };

  export type RequestMethod = 'GET' | 'POST' | 'HEAD' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

  /**
   * A request for a route of the service `T`: its method, a path its path pattern matches and, unless a naming
   * style renames the fields on the wire, the body its handler takes.
   */
  export type Request<T extends Http.Service = Http.Service> = RouteRequest<T, ServiceRoute<T>>;

  export type RequestOptions = Tester.RequestOptions & {
    /**
     * Identity the route handler receives when the route has an authorizer, which then doesn't run. The route
     * checks it against its identity schema the way it checks the identity an authorizer gives.
     */
    identity?: Http.Identity;
  };

  export type Response = {
    status: number;
    headers: Record<string, string>;

    /**
     * Parsed when the response is JSON.
     */
    body?: unknown;
  };

  /**
   * Send a request to the service through its emulator: route, validation, authorizer, handler and error mapping,
   * as `Tester.request` sends it, with the client overrides in `options.services`.
   */
  export const request = async <T extends Http.Service = Http.Service>(
    resourceName: string,
    request: Request<T>,
    options?: RequestOptions
  ): Promise<Response> => {
    const { method, path, headers, query, body } = request;

    const response = await Tester.request(resourceName, { method, path, headers, query, body: body as Tester.Request['body'] }, options);

    if (!response.body || !isJsonResponse(response.headers)) {
      return response;
    }

    return {
      ...response,
      body: JSON.parse(response.body.toString())
    };
  };

  /**
   * Get the context the route handlers with the provider `T` receive, where a client in `overrides` takes the place
   * of the linked one with its name.
   */
  export const getContext = <T extends Http.Provider>(resourceName: string, overrides?: Partial<Service.Context<T>>) => {
    return Tester.getContext<Service.Context<T>>(resourceName, overrides);
  };
}

const isJsonResponse = (headers: Record<string, string>) => {
  const contentType = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === 'content-type')?.[1];

  return !!contentType && /[/+]json\b/i.test(contentType);
};

type ServiceRoute<T> = T extends { routes: (infer R)[] } ? R : never;

type RouteRequest<T, R> = R extends { path: `${infer M} ${infer P}` }
  ? {
      readonly method: M extends 'ANY' ? HttpTester.RequestMethod : M;
      readonly path: RoutePath<P>;
      readonly headers?: Record<string, string>;
      readonly query?: Record<string, string>;
      readonly body?: RouteBody<T, R>;
    }
  : never;

// Each path parameter matches any text.
type RoutePath<P extends string> = P extends `${infer H}{${string}}${infer T}` ? `${H}${string}${RoutePath<T>}` : P;

type RouteBody<T, R> =
  IsRenamed<RoutePreferences<T, R>> extends true
    ? AnyObject | string
    : R extends { handler: (request: infer Q, ...inputs: any[]) => any }
      ? 'body' extends keyof Q
        ? Q['body']
        : undefined
      : unknown;

type RoutePreferences<T, R> = R extends { preferences: infer P } ? P : T extends { defaults: { preferences: infer P } } ? P : undefined;

type IsRenamed<P> = P extends { namingStyle: infer N } ? (N extends NamingStyle.Preserve ? false : true) : false;

const getHttpContract = (resourceName: string) => {
  const service = Tester.getServiceMetadata(resourceName);

  if (service && (isHttpService(service) || isHttpImport(service))) {
    return service;
  }

  return undefined;
};
