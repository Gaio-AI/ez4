/**
 * HTTP throttling configuration.
 */
export interface HttpThrottling {
  /**
   * Steady-state number of requests per second the gateway accepts across all routes.
   *
   * - Must be a positive integer.
   * - Requests above the limit are answered with `429 Too Many Requests` by the gateway.
   */
  readonly rateLimit: number;

  /**
   * Number of requests the gateway accepts at once on top of the steady-state rate.
   *
   * - Must be a positive integer.
   */
  readonly burstLimit: number;
}
