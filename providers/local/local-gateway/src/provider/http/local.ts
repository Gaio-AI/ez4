import type { EmulateServiceContext, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { HttpService } from '@ez4/gateway/library';
import type { RouteData } from '../../utils/route';

import { getCurrentInvocation, getServiceName, triggerAllAsync } from '@ez4/project/library';
import { getClientOperations, getCorsConfiguration } from '@ez4/gateway/library';
import { HttpError, HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { Logger } from '@ez4/logger';

import { HttpManifest } from '../../service/manifest/http';
import { processHttpRequest } from '../../handlers/http/request';
import { processHttpAuthorization } from '../../handlers/http/authorizer';
import { createHttpServiceClient } from '../../client/http/service';
import { getHttpErrorResponse, getHttpTimeoutResponse } from '../../utils/http/response';
import { getCorsHeaders, isPreflightRequest } from '../../utils/http/cors';
import { LambdaTimeoutError } from '../../utils/timeout';
import { getMatchingRoute } from '../../utils/route';

export const registerHttpLocalService = (service: HttpService, options: ServeOptions, context: EmulateServiceContext) => {
  const { name: resourceName, routes, cors, defaults } = service;

  const httpRoutes = buildHttpRoutes(service);

  // The same configuration the deploy gives API Gateway.
  const corsConfiguration = cors && getCorsConfiguration(routes, cors, defaults);

  const clientOptions = {
    operations: getClientOperations(service),
    ...options
  };

  return {
    type: 'Gateway',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    exportHandler: () => {
      return createHttpServiceClient(resourceName, clientOptions);
    },
    manifestHandler: () => {
      return HttpManifest.build(service);
    },
    corsHandler: (request: EmulatorRequestEvent) => {
      // Without CORS declared, API Gateway sends no CORS headers and routes preflights as any other request.
      if (!corsConfiguration) {
        return undefined;
      }

      return getCorsHeaders(corsConfiguration, request);
    },
    requestHandler: async (request: EmulatorRequestEvent) => {
      const currentRoute = getMatchingRoute(httpRoutes, request);

      try {
        if (!currentRoute) {
          // With CORS declared, API Gateway answers the preflights no route takes.
          if (corsConfiguration && isPreflightRequest(request)) {
            return {
              status: 204
            };
          }

          const fallback = await triggerAllAsync('emulator:fallbackRequest', (handler) => {
            return handler({ request, service, options });
          });

          if (!fallback) {
            throw new HttpNotFoundError();
          }

          return fallback;
        }

        if (!currentRoute.authorizer) {
          return await processHttpRequest(service, options, context, currentRoute);
        }

        // A test request can bring the identity, which takes the place of the authorizer for that request only.
        const identity = getCurrentInvocation()?.identity ?? (await processHttpAuthorization(service, options, context, currentRoute));

        if (identity) {
          return await processHttpRequest(service, options, context, currentRoute, identity);
        }

        return getHttpErrorResponse(new HttpForbiddenError());
        //
      } catch (error) {
        if (error instanceof LambdaTimeoutError) {
          return getHttpTimeoutResponse();
        }

        const response = getHttpErrorResponse(error, currentRoute?.httpErrors);

        // The response hides what failed, so the log keeps it.
        if (!(error instanceof HttpError) && response.status === 500) {
          logInternalError(resourceName, error);
        }

        return response;
      }
    }
  };
};

const logInternalError = (resourceName: string, error: unknown) => {
  if (error instanceof Error && error.stack) {
    Logger.error(`Gateway [${resourceName}] Internal server error\n${error.stack}`);
  } else {
    Logger.error(`Gateway [${resourceName}] ${error}`);
  }
};

const buildHttpRoutes = (service: HttpService) => {
  const httpRoutes: Record<string, Record<string, RouteData>> = {
    ANY: {}
  };

  const defaultPreferences = service.defaults?.preferences;
  const defaultTimeout = service.defaults?.timeout;
  const defaultErrors = service.defaults?.httpErrors;
  const defaultScope = service.defaults?.scope;

  for (const route of service.routes) {
    const [method, path] = route.path.split(' ', 2);

    if (!httpRoutes[method]) {
      httpRoutes[method] = {};
    }

    httpRoutes[method][path] = {
      httpErrors: { ...defaultErrors, ...route.httpErrors },
      preferences: route.preferences ?? defaultPreferences,
      timeout: route.timeout ?? defaultTimeout,
      variables: route.variables,
      authorizer: route.authorizer,
      listener: route.listener,
      scope: { ...defaultScope, ...route.scope },
      handler: route.handler
    };
  }

  return httpRoutes;
};
