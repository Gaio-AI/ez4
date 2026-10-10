import type { HttpRequest } from './request';

/**
 * Incoming request.
 */
export type HttpIncoming<T extends HttpRequest> = T & {
  /**
   *  Unique identifier for the request.
   */
  readonly requestId: string;

  /**
   * Unique identifier across multiple services.
   */
  readonly traceId?: string;

  /**
   * Determines whether request is base64 encoded or not.
   */
  readonly encoded?: boolean;

  /**
   * Request timestamp.
   */
  readonly timestamp: Date;

  /**
   * Request method.
   */
  readonly method: string;

  /**
   * Request path.
   */
  readonly path: string;

  /**
   * Route that matched the request, as declared (e.g. `GET /items/{id}`).
   *
   * - Set when the route is served by a route group's function.
   */
  readonly routeKey?: string;

  /**
   * Raw body data (when provided in the request).
   */
  readonly data?: string;
};
