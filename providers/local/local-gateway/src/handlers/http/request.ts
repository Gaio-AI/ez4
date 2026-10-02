import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { ValidationCustomContext } from '@ez4/validator';
import type { HttpService } from '@ez4/gateway/library';
import type { Http } from '@ez4/gateway';
import type { MatchingRoute } from '../../utils/route';

import { createModule, onBegin, onReady, onDone, onError, onEnd, onTimeout } from '@ez4/local-common';
import { getRandomUUID, pickObject } from '@ez4/utils';
import { assertQueryStrings, resolveValidation } from '@ez4/gateway/utils';
import { Runtime } from '@ez4/common';

import { getHttpErrorResponse, getHttpSuccessResponse, getTracedResponse } from '../../utils/http/response';
import { getLambdaTimeout, runWithLambdaTimeout } from '../../utils/timeout';

import {
  getIncomingRequestIdentity,
  getIncomingRequestParameters,
  getIncomingRequestHeaders,
  getIncomingRequestQuery,
  getIncomingRequestBody
} from '../../utils/request';

export const processHttpRequest = (
  service: HttpService,
  options: ServeOptions,
  context: EmulateServiceContext,
  route: MatchingRoute,
  identity?: Http.Identity
) => {
  // A scope of its own, as each Lambda invocation has, so concurrent requests don't overwrite each other's.
  return Runtime.runWithScope(() => handleHttpRequest(service, options, context, route, identity));
};

const handleHttpRequest = async (
  service: HttpService,
  options: ServeOptions,
  context: EmulateServiceContext,
  route: MatchingRoute,
  identity?: Http.Identity
) => {
  const handler = route.handler;

  const provider = handler.provider;
  const services = provider?.services ?? {};

  const servicesInUse = route.handler.references ? pickObject(services, route.handler.references) : services;
  const serviceClients = context.makeClients(servicesInUse);

  const traceId = Runtime.readTraceId(route.headers);

  Runtime.setScope({ ...Runtime.readScopeValues(route.scope, route.headers), traceId }, route.scope);

  const module = await createModule({
    listener: route.listener ?? service.defaults?.listener,
    version: options.version,
    handler,
    variables: {
      ...options.variables,
      ...service.variables,
      ...route.variables,
      ...provider?.variables
    }
  });

  const currentRequest: Http.Incoming<Http.Request> = {
    requestId: getRandomUUID(),
    timestamp: new Date(),
    method: route.method,
    path: route.path,
    encoded: false,
    data: route.body?.toString(),
    traceId
  };

  const onCustomValidation = (value: unknown, context: ValidationCustomContext) => {
    return resolveValidation(value, serviceClients, context.type);
  };

  const invokeHandler = async () => {
    try {
      await onBegin(module, serviceClients, currentRequest);

      // As the gateway runtime, a strict route checks the query strings even when its request declares none.
      await assertQueryStrings(route.query ?? {}, handler.request?.query, route.preferences);

      if (handler.request) {
        Object.assign(currentRequest, await getIncomingRequestIdentity(handler.request, identity, onCustomValidation));
        Object.assign(currentRequest, await getIncomingRequestHeaders(handler.request, route, onCustomValidation));
        Object.assign(currentRequest, await getIncomingRequestParameters(handler.request, route, onCustomValidation));
        Object.assign(currentRequest, await getIncomingRequestQuery(handler.request, route, onCustomValidation));
        Object.assign(currentRequest, await getIncomingRequestBody(handler.request, route, onCustomValidation));
      }

      await onReady(module, serviceClients, currentRequest);

      const response = await module.handler<Http.Response>(currentRequest, serviceClients);
      const preferences = route.preferences;

      await onDone(module, serviceClients, currentRequest);

      return getTracedResponse(getHttpSuccessResponse(route.handler.response, response, preferences));
      //
    } catch (error) {
      await onError(module, serviceClients, currentRequest, error);

      return getTracedResponse(getHttpErrorResponse(error, route.httpErrors));
      //
    } finally {
      await onEnd(module, serviceClients, currentRequest);
    }
  };

  return runWithLambdaTimeout(
    {
      timeout: getLambdaTimeout(route.timeout),
      source: module.source,
      onTimeout: () => onTimeout(module, serviceClients, currentRequest)
    },
    invokeHandler
  );
};
