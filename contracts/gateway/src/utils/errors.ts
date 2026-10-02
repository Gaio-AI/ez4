import type { ServiceErrorContext } from '@ez4/common';
import type { HttpErrorHeaders } from '@ez4/gateway';

import {
  HttpBadRequestError,
  HttpUnauthorizedError,
  HttpForbiddenError,
  HttpNotFoundError,
  HttpConflictError,
  HttpUnsupportedMediaTypeError,
  HttpUnprocessableEntityError,
  HttpTooManyRequestsError,
  HttpError
} from '@ez4/gateway';

// The gateway sets them for every error response: the body is always JSON, and the trace id is the request's.
const RESERVED_HEADERS = new Set(['content-type', 'x-trace-id']);

/**
 * Get a JSON error response for the given HTTP error.
 *
 * @returns Returns an error response containing `status`, the error `headers` (when it has any)
 * and a body with `message` and `context`.
 */
export const getJsonError = ({ status, message, context, headers }: HttpError) => {
  return {
    status,
    ...(headers && {
      headers: getErrorHeaders(headers)
    }),
    body: {
      type: 'error',
      message,
      context
    }
  };
};

const getErrorHeaders = (headers: HttpErrorHeaders) => {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !RESERVED_HEADERS.has(name.toLowerCase())));
};

/**
 * Get an exception based on the given HTTP status code.
 *
 * @param status HTTP status code.
 * @param message Exception message.
 * @param context Exception context.
 * @returns Returns the corresponding exception.
 */
export const getHttpException = (status: number, message: string, context?: ServiceErrorContext) => {
  switch (status) {
    case 400:
      return new HttpBadRequestError(message, context);

    case 401:
      return new HttpUnauthorizedError(message, context);

    case 403:
      return new HttpForbiddenError(message, context);

    case 404:
      return new HttpNotFoundError(message, context);

    case 409:
      return new HttpConflictError(message, context);

    case 415:
      return new HttpUnsupportedMediaTypeError(message, context);

    case 422:
      return new HttpUnprocessableEntityError(message, context);

    case 429:
      return new HttpTooManyRequestsError(message, context);

    default:
      return new HttpError(status, message, context);
  }
};
