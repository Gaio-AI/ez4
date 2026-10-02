import type { ServiceErrorContext } from '@ez4/common';

import { ServiceError } from '@ez4/common';

/**
 * HTTP error response headers.
 */
export type HttpErrorHeaders = Record<string, string>;

/**
 * Default HTTP error.
 *
 * @param headers Response headers (e.g. `retry-after`), except `content-type` and `x-trace-id`, which the gateway sets.
 */
export class HttpError extends ServiceError {
  constructor(
    public status: number,
    message: string,
    context?: ServiceErrorContext,
    public headers?: HttpErrorHeaders
  ) {
    super(message, context);
  }
}

/**
 * HTTP Bad Request error.
 */
export class HttpBadRequestError extends HttpError {
  constructor(message?: string, context?: ServiceErrorContext, headers?: HttpErrorHeaders) {
    super(400, message || 'Bad request', context, headers);
  }
}

/**
 * HTTP Unauthorized error.
 */
export class HttpUnauthorizedError extends HttpError {
  constructor(message?: string, context?: ServiceErrorContext, headers?: HttpErrorHeaders) {
    super(401, message || 'Unauthorized', context, headers);
  }
}

/**
 * HTTP Forbidden error.
 */
export class HttpForbiddenError extends HttpError {
  constructor(message?: string, context?: ServiceErrorContext, headers?: HttpErrorHeaders) {
    super(403, message || 'Forbidden', context, headers);
  }
}

/**
 * HTTP Not Found error.
 */
export class HttpNotFoundError extends HttpError {
  constructor(message?: string, context?: ServiceErrorContext, headers?: HttpErrorHeaders) {
    super(404, message || 'Not found', context, headers);
  }
}

/**
 * HTTP Conflict error.
 */
export class HttpConflictError extends HttpError {
  constructor(message?: string, context?: ServiceErrorContext, headers?: HttpErrorHeaders) {
    super(409, message || 'Conflict', context, headers);
  }
}

/**
 * HTTP Unsupported Media Type error.
 */
export class HttpUnsupportedMediaTypeError extends HttpError {
  constructor(message?: string, context?: ServiceErrorContext, headers?: HttpErrorHeaders) {
    super(415, message || 'Unsupported media type', context, headers);
  }
}

/**
 * HTTP Unprocessable Entity error.
 */
export class HttpUnprocessableEntityError extends HttpError {
  constructor(message?: string, context?: ServiceErrorContext, headers?: HttpErrorHeaders) {
    super(422, message || 'Unprocessable entity', context, headers);
  }
}

/**
 * HTTP Too Many Requests error.
 */
export class HttpTooManyRequestsError extends HttpError {
  constructor(message?: string, context?: ServiceErrorContext, headers?: HttpErrorHeaders) {
    super(429, message || 'Too many requests', context, headers);
  }
}

/**
 * HTTP Internal Server error.
 */
export class HttpInternalServerError extends HttpError {
  constructor(message?: string, context?: ServiceErrorContext, headers?: HttpErrorHeaders) {
    super(500, message || 'Internal server error', context, headers);
  }
}
