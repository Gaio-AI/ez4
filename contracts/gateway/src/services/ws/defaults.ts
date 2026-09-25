import type { WebDefaults } from '../defaults';
import type { WsRequest } from './request';
import type { WsListener } from './listener';
import type { WsEvent } from './event';

/**
 * Default WS service parameters.
 */
export interface WsDefaults<T extends WsRequest | WsEvent> extends WebDefaults {
  /**
   * Default life‑cycle listener for all routes.
   *
   * - Runs inside the same cloud resource as the handler.
   * - Receives events such as request begin, request end, and internal transitions.
   * - Useful for logging, tracing, metrics, and instrumentation.
   */
  readonly listener?: WsListener<T>;

  /**
   * Maps scope keys to the request headers they are read from.
   *
   * - Read by the connect handler and its authorizer; each name falls back to the query string
   *   parameter of the same name, since browsers cannot set WebSocket headers.
   * - Message and disconnect handlers do not receive the scope.
   * - Values longer than 256 characters are truncated.
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
