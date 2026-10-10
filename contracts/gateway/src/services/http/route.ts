import type { AuthHandler } from '../auth/handler';
import type { AuthRequest } from '../auth/request';
import type { WebTarget } from '../target';
import type { HttpListener } from './listener';
import type { HttpRequest } from './request';
import type { HttpHandler } from './handler';
import type { HttpErrors } from './errors';
import type { HttpPath } from './path';

// Brings the `Http.Service` groups declaration of `./group` to whoever reads the route contract.
export type { HttpGroup } from './group';

/**
 * HTTP route.
 */
export interface HttpRoute<T extends HttpRequest, U extends AuthRequest> extends WebTarget {
  /**
   * Operation name for the route.
   *
   * - When omitted, the route is excluded from the generated API client.
   * - Used for documentation (e.g., OpenAPI generation).
   * - Used to name API client methods.
   */
  readonly name?: string;

  /**
   * HTTP verb and path for the route.
   *
   * - Path parameters must be wrapped in `{}`.
   *
   * @example
   * ```ts
   * path: 'GET /root/{parameter}/path'
   * ```
   */
  readonly path: HttpPath;

  /**
   * Optional life‑cycle listener for the route.
   *
   * - Runs inside the same cloud resource as the handler and authorizer.
   * - Receives events such as request begin, request end, and internal transitions.
   * - Useful for logging, tracing, metrics, and instrumentation.
   */
  readonly listener?: HttpListener<T>;

  /**
   * Optional entry‑point authorizer for the route.
   *
   * - Runs in a separate cloud resource isolated from the route handler.
   * - Must complete successfully before the route handler is invoked.
   * - Can enrich the request with authentication/authorization context.
   */
  readonly authorizer?: AuthHandler<U>;

  /**
   * Main entry‑point function for the route.
   *
   * - Runs in its own cloud resource.
   * - Invoked only after the authorizer (if defined) succeeds.
   */
  readonly handler: HttpHandler<T>;

  /**
   * Route group whose function serves the route.
   *
   * - Routes of the same group share one function, log group and integration, which picks the
   *   route by its key (`path`) and keeps its own validation, errors, preferences and scope.
   * - Function settings (memory, timeout, runtime, listener, ...) come from the service `groups`,
   *   then `defaults`: the route may declare one only with that same value.
   * - Route variables join the group's function, and a variable can't take two values in it.
   * - Without a group, the route keeps a function of its own.
   */
  readonly group?: string;

  /**
   * Maps known exceptions to HTTP status codes.
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
   * Disables the route.
   *
   * - Disabled routes are ignored during deployment.
   * - No cloud resources are created for them.
   */
  readonly disabled?: boolean;

  /**
   * Enables CORS for the route.
   *
   * - When enabled, CORS responses include the route's HTTP verb and headers.
   * - Automatically generates the `OPTIONS` preflight route.
   */
  readonly cors?: boolean;

  /**
   * Maps scope keys to the request headers they are read from.
   *
   * - Merged over `defaults.scope`; the route wins on a key clash.
   * - A handler shared by several routes uses the scope of the first route that deploys it.
   *
   * @example
   * ```ts
   * scope: {
   *   requestSource: 'x-request-source';
   * }
   * ```
   */
  readonly scope?: Record<string, string>;

  /**
   * Enables VPC access for the route.
   *
   * - Allows the handler to access private resources inside the default VPC.
   * - May increase cold‑start latency.
   */
  readonly vpc?: boolean;
}
