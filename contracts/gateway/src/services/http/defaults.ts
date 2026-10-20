import type { WebDefaults } from '../defaults';
import type { HttpListener } from './listener';
import type { HttpRequest } from './request';
import type { HttpErrors } from './errors';
import type { HttpGuard } from './guard';

/**
 * Default HTTP service parameters.
 */
export interface HttpDefaults<T extends HttpRequest> extends WebDefaults {
  /**
   * Default life‑cycle listener for all routes.
   *
   * - Runs inside the same cloud resource as the handler.
   * - Receives events such as request begin, request end, and internal transitions.
   * - Useful for logging, tracing, metrics, and instrumentation.
   */
  readonly listener?: HttpListener<T>;

  /**
   * Guard for all routes, which decides whether a request may reach the handler from the route's `allow`.
   *
   * - Runs inside the route's function, after the request is validated and right before the handler.
   * - Every route must declare `allow`: a route without one fails the build instead of going unguarded.
   * - Not run by authorizers, which are shared between routes and cached by their identity source.
   */
  readonly guard?: HttpGuard<T>;

  /**
   * Maps known exceptions to HTTP status codes across all handlers.
   *
   * - Any exception listed here will be translated to the specified status code.
   * - Unmapped exceptions default to HTTP 500 (Internal Server Error).
   *
   * @example
   * ```ts
   * httpErrors: {
   *   400: [InvalidInputError];
   *   404: [NotFoundError];
   * }
   * ```
   */
  readonly httpErrors?: HttpErrors;

  /**
   * Maps scope keys to the request headers they are read from.
   *
   * - Each declared header is read by the route handler and authorizer and exposed through `Runtime.getScope()`.
   * - Values longer than 256 characters are truncated.
   * - Declared headers are added to the CORS allowed headers.
   * - The HTTP client, queues, topics and schedulers carry the scope to the next handler.
   *
   * @example
   * ```ts
   * scope: {
   *   clientVersion: 'x-client-version';
   * }
   * ```
   */
  readonly scope?: Record<string, string>;
}
