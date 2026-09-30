import type { HttpClient, HttpClientRequest, HttpClientResponse, Http } from '@ez4/gateway';
import type { ClientOperation, HttpImport, HttpRoute, HttpService } from '@ez4/gateway/library';
import type { AnyObject } from '@ez4/utils';

import { mock } from 'node:test';

import { getClientOperations } from '@ez4/gateway/library';
import { prepareQueryStrings, prepareRequestBody, prepareResponseBody } from '@ez4/http';
import { getHttpException, resolvePathParameters, resolveQueryStrings, resolveRequestBody, resolveResponseBody } from '@ez4/gateway/utils';
import { HttpError, HttpInternalServerError } from '@ez4/gateway';
import { isObjectSchema, isScalarSchema } from '@ez4/schema';
import { isAnyString } from '@ez4/utils';
import { Logger } from '@ez4/logger';

export type HttpClientMockOperation = (request: HttpClientRequest) => Promise<HttpClientResponse>;

export type HttpClientMockResponses = {
  operations?: Record<string, HttpClientMockOperation | unknown>;
  default: HttpClientMockOperation | HttpClientResponse;
};

export type HttpClientMockContract = HttpService | HttpImport;

type ContractOperation = {
  operation: ClientOperation;
  route: HttpRoute;
};

// A tracker of its own, so `mock.restoreAll()` or `mock.reset()` in another spec of the same process leaves these mocks alone.
const tracker = new (mock.constructor as new () => typeof mock)();

export const createHttpClientMock = <T extends Http.Service>(
  resourceName: string,
  responses: HttpClientMockResponses,
  contract?: HttpClientMockContract
): HttpClient<T> => {
  const operationsCache: Record<string, HttpClientMockOperation | HttpClientResponse> = {};
  const contractOperations = contract && getContractOperations(contract);

  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (!isAnyString(property)) {
          throw new Error(`Operation '${property.toString()}' wasn't found.`);
        }

        if (property === 'then') {
          return undefined;
        }

        // The real client has an operation only for each named route of the service.
        if (contractOperations && !contractOperations[property]) {
          throw new Error(`Operation '${property}' wasn't found.`);
        }

        if (!operationsCache[property]) {
          const operation = responses.operations?.[property] ?? responses.default;
          const contractOperation = contractOperations?.[property];

          operationsCache[property] = tracker.fn(async (request: HttpClientRequest) => {
            Logger.log(`🌐 Sending request to gateway [${resourceName}]`);

            if (contractOperation) {
              await assertIncomingRequest(request, contractOperation);
            }

            try {
              const response = operation instanceof Function ? await operation(request) : operation;

              const { status, headers, body } = response;

              if (status < 200 || status > 299) {
                throw getHttpException(status, body?.message, body?.context ?? body?.details);
              }

              return {
                status,
                headers,
                body: contractOperation ? getReceivedBody(body, contractOperation) : body
              };

              //
            } catch (error) {
              if (!(error instanceof HttpError)) {
                throw new HttpInternalServerError();
              }

              throw error;
            }
          });
        }

        return operationsCache[property];
      }
    }
  );
};

const getContractOperations = (contract: HttpClientMockContract) => {
  const clientOperations = getClientOperations(contract);
  const contractOperations: Record<string, ContractOperation> = {};

  for (const route of contract.routes) {
    const operation = route.name && clientOperations[route.name];

    if (route.name && operation) {
      contractOperations[route.name] = {
        operation,
        route
      };
    }
  }

  return contractOperations;
};

// The request goes through what the real client sends and what the service's runtime validates, so a request the
// service answers with 400 fails here with the same error.
const assertIncomingRequest = async (request: HttpClientRequest, { operation, route }: ContractOperation) => {
  const requestSchema = route.handler.request;

  if (!requestSchema) {
    return;
  }

  const { namingStyle } = operation;

  const preferences = {
    namingStyle
  };

  if (requestSchema.parameters) {
    await resolvePathParameters(getSentParameters(request.parameters), requestSchema.parameters);
  }

  if (requestSchema.query) {
    const queryStrings = request.query && prepareQueryStrings(request.query, operation.querySchema, namingStyle);

    await resolveQueryStrings(getReceivedQuery(queryStrings), requestSchema.query, preferences);
  }

  if (requestSchema.body) {
    const payload = request.body !== undefined ? prepareRequestBody(request.body, operation.bodySchema, namingStyle) : undefined;

    const bodySchema = requestSchema.body;

    if (isScalarSchema(bodySchema) || (isObjectSchema(bodySchema) && bodySchema.definitions?.encoded)) {
      await resolveRequestBody(payload?.body, bodySchema);
    } else {
      await resolveRequestBody(payload?.body && JSON.parse(payload.body), bodySchema, preferences);
    }
  }
};

// The canned body stands for what the service's handler returns: it's serialized by the service and parsed by
// the client, so a route without a response body sends none and fields out of the contract never reach the caller.
const getReceivedBody = (body: unknown, { operation }: ContractOperation) => {
  const { responseSchema, namingStyle } = operation;

  if (body === undefined || !responseSchema) {
    return undefined;
  }

  if (isScalarSchema(responseSchema)) {
    return `${body}`;
  }

  const sentBody = resolveResponseBody(body, responseSchema, { namingStyle });

  return prepareResponseBody(JSON.stringify(sentBody), responseSchema, namingStyle);
};

const getSentParameters = (parameters: AnyObject | undefined) => {
  const pathParameters: Record<string, string> = {};

  for (const parameterName in parameters) {
    pathParameters[parameterName] = `${parameters[parameterName]}`;
  }

  return pathParameters;
};

const getReceivedQuery = (queryStrings: string | undefined) => {
  const searchParameters = new URLSearchParams(queryStrings);
  const query: Record<string, string> = {};

  for (const name of searchParameters.keys()) {
    query[name] = searchParameters.getAll(name).join(',');
  }

  return query;
};
