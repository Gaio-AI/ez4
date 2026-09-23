/**
 * Cache-Control rule for objects synchronized from `localPath`.
 */
export interface BucketCacheRule {
  /**
   * Object key pattern: an exact key, `prefix/*` or `*` for any key.
   */
  readonly path: string;

  /**
   * Cache-Control header value.
   */
  readonly value: string;
}
