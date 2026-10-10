import type { APIGatewayProxyEventV2WithLambdaAuthorizer, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import type { ArraySchema, ObjectSchema, ScalarSchema, UnionSchema } from '@ez4/schema';
import type { ValidationCustomContext } from '@ez4/validator';
import type { HttpPreferences } from '@ez4/gateway/library';
import type { AnyObject } from '@ez4/utils';
import type { Http } from '@ez4/gateway';

import { HttpError, HttpInternalServerError, HttpNotFoundError } from '@ez4/gateway';
import { isObjectSchema, isScalarSchema } from '@ez4/schema';
import { ServiceEventType, Runtime, ServiceError } from '@ez4/common';

import {
  resolveHeaders,
  resolvePathParameters,
  assertQueryStrings,
  resolveQueryStrings,
  resolveIdentity,
  parseRequestBody,
  resolveRequestBody,
  resolveValidation,
  resolveResponseBody,
  getJsonError
} from '@ez4/gateway/utils';

type RequestEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<any>;
type ResponseEvent = APIGatewayProxyResultV2;

type RouteHandler = (request: Http.Incoming<Http.Request>, context: object) => Promise<Http.Response>;

/**
 * A route of the group: the position of its handler in `__EZ4_HANDLERS` and its settings as JSON.
 */
type GroupRoute = {
  handler: number;
  config: string;
};

type RouteConfig = {
  headersSchema?: ObjectSchema;
  parametersSchema?: ObjectSchema;
  querySchema?: ObjectSchema;
  identitySchema?: ObjectSchema | UnionSchema;
  bodySchema?: ObjectSchema | UnionSchema | ArraySchema | ScalarSchema;
  responseSchema?: ObjectSchema | UnionSchema | ArraySchema | ScalarSchema;
  errorsMap?: Record<string, number>;
  preferences?: HttpPreferences;
  scope?: Runtime.ScopeHeaders;
};

declare const __EZ4_ROUTES: Record<string, GroupRoute>;
declare const __EZ4_HANDLERS: RouteHandler[];
declare const __EZ4_CONTEXT: object;

declare function dispatch(event: Http.ServiceEvent<Http.Request>, context: object): Promise<void>;

// Settings are parsed on the first request of each route, so the cold start doesn't pay for routes it doesn't serve.
const routeConfigs = new WeakMap<GroupRoute, RouteConfig>();

/**
 * Entrypoint to handle API Gateway requests for every route of a group.
 */
export async function apiEntryPoint(event: RequestEvent, context: Context): Promise<ResponseEvent> {
  const { requestContext, routeKey } = event;

  const traceId = Runtime.readTraceId(event.headers);

  const route = getGroupRoute(routeKey);

  if (!route) {
    return getUnknownRouteResponse(routeKey, traceId);
  }

  const config = getRouteConfig(route);
  const handle = __EZ4_HANDLERS[route.handler];

  const milliseconds = Math.max(0, context.getRemainingTimeInMillis() - 1000);
  const timeoutEvent = setTimeout(() => onTimeout(request, milliseconds), milliseconds);

  const request: Http.Incoming<Http.Request> = {
    requestId: context.awsRequestId,
    timestamp: new Date(requestContext.timeEpoch),
    method: requestContext.http.method,
    path: requestContext.http.path,
    encoded: event.isBase64Encoded,
    data: event.body,
    routeKey,
    traceId
  };

  Runtime.setScope(
    {
      ...Runtime.readScopeValues(config.scope, event.headers),
      traceId
    },
    config.scope
  );

  try {
    await onBegin(request);

    Object.assign(request, await getIncomingRequest(event, config));

    await onReady(request);

    const { status, body, headers } = await handle(request, __EZ4_CONTEXT);

    await onDone(request);

    return getSuccessResponse(config, status, body, headers);
  } catch (error) {
    await onError(error, request, config);

    if (error instanceof HttpError) {
      return getDefaultErrorResponse(error);
    }

    if (error instanceof Error) {
      return getMappedErrorResponse(error, config);
    }

    return getDefaultErrorResponse();
  } finally {
    clearTimeout(timeoutEvent);
    await onEnd(request);
  }
}

const getGroupRoute = (routeKey: string) => {
  // An own key only, so a route key never reads the object's prototype.
  if (Object.hasOwn(__EZ4_ROUTES, routeKey)) {
    return __EZ4_ROUTES[routeKey];
  }

  return undefined;
};

const getRouteConfig = (route: GroupRoute) => {
  let config = routeConfigs.get(route);

  if (!config) {
    config = JSON.parse(route.config) as RouteConfig;
    routeConfigs.set(route, config);
  }

  return config;
};

// The gateway only invokes the group for its own routes, so another key means a deploy left the two apart.
const getUnknownRouteResponse = (routeKey: string, traceId: string) => {
  Runtime.setScope({ traceId });

  console.error({ ...Runtime.getScope(), routeKey, error: 'Route not served by this group.' });

  return getDefaultErrorResponse(new HttpNotFoundError());
};

const getIncomingRequest = async (event: RequestEvent, config: RouteConfig) => {
  return {
    headers: config.headersSchema ? await getIncomingRequestHeaders(event, config.headersSchema) : undefined,
    parameters: config.parametersSchema ? await getIncomingRequestParameters(event, config.parametersSchema) : undefined,
    query: await getIncomingRequestQueryStrings(event, config),
    identity: config.identitySchema ? await getIncomingRequestIdentity(event, config.identitySchema) : undefined,
    body: config.bodySchema ? await getIncomingRequestBody(event, config.bodySchema, config.preferences) : undefined
  };
};

const getIncomingRequestHeaders = (event: RequestEvent, headersSchema: ObjectSchema) => {
  return resolveHeaders(event.headers ?? {}, headersSchema, onCustomValidation);
};

const getIncomingRequestParameters = (event: RequestEvent, parametersSchema: ObjectSchema) => {
  return resolvePathParameters(event.pathParameters ?? {}, parametersSchema, onCustomValidation);
};

const getIncomingRequestQueryStrings = async (event: RequestEvent, config: RouteConfig) => {
  const { querySchema, preferences } = config;

  const queryStrings = event.queryStringParameters ?? {};

  // A strict route checks the query strings even when its request declares none.
  await assertQueryStrings(queryStrings, querySchema, preferences);

  if (querySchema) {
    return resolveQueryStrings(queryStrings, querySchema, preferences, onCustomValidation);
  }

  return undefined;
};

const getIncomingRequestIdentity = (event: RequestEvent, identitySchema: ObjectSchema | UnionSchema) => {
  const identity = event.requestContext?.authorizer?.lambda?.identity;

  return resolveIdentity(JSON.parse(identity ?? '{}'), identitySchema, onCustomValidation);
};

const getIncomingRequestBody = (
  event: RequestEvent,
  bodySchema: ObjectSchema | UnionSchema | ArraySchema | ScalarSchema,
  preferences: HttpPreferences | undefined
) => {
  const { body } = event;

  if (isScalarSchema(bodySchema) || (isObjectSchema(bodySchema) && bodySchema.definitions?.encoded)) {
    return resolveRequestBody(body, bodySchema, undefined, onCustomValidation);
  }

  const payload = parseRequestBody(body);

  return resolveRequestBody(payload, bodySchema, preferences, onCustomValidation);
};

const getOutgoingResponseBody = (config: RouteConfig, body: Http.JsonBody | Http.RawBody, headers?: AnyObject) => {
  const { responseSchema, preferences } = config;

  if (!responseSchema) {
    return undefined;
  }

  if (isScalarSchema(responseSchema)) {
    return {
      type: headers?.['content-type'] ?? 'application/octet-stream',
      content: Buffer.from(body.toString(), 'utf-8').toString('base64'),
      encoded: true
    };
  }

  const payload = resolveResponseBody(body, responseSchema, preferences);

  return {
    type: 'application/json',
    content: JSON.stringify(payload),
    encoded: false
  };
};

const getSuccessResponse = (config: RouteConfig, status: number, body?: Http.JsonBody | Http.RawBody, headers?: Http.Headers) => {
  const response = body ? getOutgoingResponseBody(config, body, headers) : undefined;
  const scope = Runtime.getScope();

  return {
    statusCode: status,
    isBase64Encoded: response?.encoded,
    headers: {
      ...headers,
      ...(response && {
        ['content-type']: response.type
      }),
      ...(scope && {
        ['x-trace-id']: scope.traceId
      })
    },
    ...(response && {
      body: response.content
    })
  };
};

const getDefaultErrorResponse = (error?: HttpError) => {
  const response = getJsonError(error ?? new HttpInternalServerError());
  const scope = Runtime.getScope();

  return {
    statusCode: response.status,
    body: JSON.stringify(response.body),
    headers: {
      ...response.headers,
      ['content-type']: 'application/json',
      ...(scope && {
        ['x-trace-id']: scope.traceId
      })
    }
  };
};

const getMappedErrorResponse = (error: Error, config: RouteConfig) => {
  const { errorsMap } = config;

  if (!errorsMap) {
    return getDefaultErrorResponse();
  }

  const errorType = Object.getPrototypeOf(error);
  const errorClass = errorType?.constructor;
  const errorName = errorClass?.name;

  const statusCode = errorsMap[errorName];

  if (!statusCode) {
    return getDefaultErrorResponse();
  }

  return getDefaultErrorResponse({
    status: statusCode,
    message: error.message,
    name: errorName,
    ...(error instanceof ServiceError && {
      context: error.context
    })
  });
};

const onCustomValidation = (value: unknown, context: ValidationCustomContext) => {
  return resolveValidation(value, __EZ4_CONTEXT, context.type);
};

const onBegin = (request: Partial<Http.Incoming<Http.Request>>) => {
  return dispatch(
    {
      type: ServiceEventType.Begin,
      request
    },
    __EZ4_CONTEXT
  );
};

const onReady = (request: Partial<Http.Incoming<Http.Request>>) => {
  return dispatch(
    {
      type: ServiceEventType.Ready,
      request
    },
    __EZ4_CONTEXT
  );
};

const onDone = (request: Partial<Http.Incoming<Http.Request>>) => {
  return dispatch(
    {
      type: ServiceEventType.Done,
      request
    },
    __EZ4_CONTEXT
  );
};

const onTimeout = (request: Partial<Http.Incoming<Http.Request>>, timeoutAfter: number) => {
  console.warn({ ...Runtime.getScope(), timeoutAfter });

  return dispatch(
    {
      type: ServiceEventType.Timeout,
      request
    },
    __EZ4_CONTEXT
  );
};

const getErrorStatus = (error: unknown, config: RouteConfig) => {
  if (error instanceof HttpError) {
    return error.status;
  }

  if (error instanceof Error) {
    const errorName = Object.getPrototypeOf(error)?.constructor?.name;

    return (errorName && config.errorsMap?.[errorName]) || 500;
  }

  return 500;
};

const onError = (error: unknown, request: Partial<Http.Incoming<Http.Request>>, config: RouteConfig) => {
  Runtime.reportError(error, getErrorStatus(error, config));

  return dispatch(
    {
      type: ServiceEventType.Error,
      request,
      error
    },
    __EZ4_CONTEXT
  );
};

const onEnd = (request: Partial<Http.Incoming<Http.Request>>) => {
  return dispatch(
    {
      type: ServiceEventType.End,
      request
    },
    __EZ4_CONTEXT
  );
};
