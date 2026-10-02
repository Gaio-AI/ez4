import type { HttpErrors, HttpResponse } from '@ez4/gateway/library';
import type { EmulatorResponse } from '@ez4/project/library';
import type { AnyObject } from '@ez4/utils';
import type { Http } from '@ez4/gateway';

import { getJsonError, resolveResponseBody } from '@ez4/gateway/utils';
import { getErrorResponse, getSuccessResponse } from '@ez4/local-common';
import { HttpError, HttpInternalServerError } from '@ez4/gateway';
import { Runtime, ServiceError } from '@ez4/common';
import { isScalarSchema } from '@ez4/schema';

export const getHttpSuccessResponse = (metadata: HttpResponse, response: Http.Response, preferences?: Http.Preferences) => {
  const { status, body, headers } = response;

  if (!metadata.body || !body) {
    return getSuccessResponse(status, headers);
  }

  if (isScalarSchema(metadata.body)) {
    const contentType = (headers as AnyObject)?.['content-type'] ?? 'application/octet-stream';

    return getSuccessResponse(status, headers, contentType, body.toString());
  }

  const payload = JSON.stringify(resolveResponseBody(body, metadata.body, preferences));

  return getSuccessResponse(status, headers, 'application/json', payload);
};

export const getHttpErrorResponse = (error: unknown, errorsMap?: HttpErrors | null) => {
  if (error instanceof HttpError) {
    return getJsonErrorResponse(error);
  }

  const errorData = error instanceof Error && errorsMap ? getMappedErrorData(error, errorsMap) : undefined;

  // As the gateway runtime, any other error answers without its details.
  return getJsonErrorResponse(errorData ?? new HttpInternalServerError());
};

// What API Gateway answers by itself when the Lambda of the route or of its authorizer times out.
export const getHttpTimeoutResponse = () => {
  return getErrorResponse(500, {
    message: 'Internal Server Error'
  });
};

// As the gateway runtime, each response of a handler carries the trace id of its scope.
export const getTracedResponse = <T extends EmulatorResponse>(response: T): T => {
  const scope = Runtime.getScope();

  if (!scope) {
    return response;
  }

  return {
    ...response,
    headers: {
      ...response.headers,
      ['x-trace-id']: scope.traceId
    }
  };
};

const getJsonErrorResponse = (error: HttpError) => {
  const { status, headers, body } = getJsonError(error);

  const response = getErrorResponse(status, body);

  return {
    ...response,
    headers: {
      ...headers,
      ...response.headers
    }
  };
};

const getMappedErrorData = (error: Error, errorsMap: HttpErrors) => {
  const errorType = Object.getPrototypeOf(error);
  const errorClass = errorType?.constructor;
  const errorName = errorClass?.name;

  const statusCode = errorsMap[errorName];

  if (!statusCode) {
    return undefined;
  }

  return {
    status: statusCode,
    message: error.message,
    name: errorName,
    ...(error instanceof ServiceError && {
      context: error.context
    })
  };
};
