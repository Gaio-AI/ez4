import type { Service as CommonService } from '@ez4/common';
import type { LinkedVariables } from '@ez4/project/library';
import type { BucketObjectEvent } from './object';
import type { BucketIncoming } from './incoming';
import type { BucketListener } from './listener';
import type { BucketRequest } from './request';
import type { BucketHandler } from './handler';
import type { BucketEvent } from './event';
import type { BucketCors } from './cors';
import type { BucketCacheRule } from './cache';
import type { Client } from './client';

/**
 * Provide all contracts for a self-managed Bucket service.
 */
export namespace Bucket {
  export type Cors = BucketCors;

  export type CacheRule = BucketCacheRule;

  export type ObjectEvent = BucketObjectEvent;

  export type Incoming = BucketIncoming<ObjectEvent>;
  export type Request = BucketRequest;

  export type Listener = BucketListener<ObjectEvent>;
  export type Handler = BucketHandler<ObjectEvent>;

  export type Event = BucketEvent;

  export type ServiceEvent =
    | CommonService.BeginEvent<Request>
    | CommonService.ReadyEvent<Incoming>
    | CommonService.DoneEvent<Incoming>
    | CommonService.TimeoutEvent<Incoming>
    | CommonService.ErrorEvent<Request | Incoming>
    | CommonService.EndEvent<Request>;

  /**
   * Bucket Event definition.
   */
  export type UseEvent<T extends Event> = T;

  /**
   * Bucket CORS definition.
   */
  export type UseCors<T extends Cors> = T;

  /**
   * Bucket Cache-Control rule definition.
   */
  export type UseCacheRule<T extends CacheRule> = T;

  /**
   * Bucket Tags definition.
   */
  export type UseTags<T extends CommonService.Tags> = T;

  /**
   * Bucket service.
   */
  export declare abstract class Service implements CommonService.Provider {
    /**
     * Overwrite the global bucket name.
     */
    readonly globalName?: string;

    /**
     * Specify a local path to synchronize with the storage.
     */
    readonly localPath?: string;

    /**
     * Maximum amount of days an object is stored before its auto-deletion.
     */
    readonly autoExpireDays?: number;

    /**
     * Days to keep objects removed from `localPath` before they expire.
     * When unset, removed objects are deleted on deploy.
     */
    readonly staleExpireDays?: number;

    /**
     * Ordered Cache-Control rules for objects synchronized from `localPath`.
     * The first rule matching the object key wins.
     */
    readonly cacheControl?: CacheRule[];

    /**
     * Bucket events.
     */
    readonly events?: Event[];

    /**
     * CORS configuration.
     */
    readonly cors?: Cors;

    /**
     * Variables associated to all events.
     */
    readonly variables?: LinkedVariables;

    /**
     * Custom tags associated to the bucket.
     */
    readonly tags?: CommonService.Tags;

    /**
     * Service client.
     */
    readonly client: Client;

    /**
     * No service options available.
     */
    readonly options: never;
  }
}
