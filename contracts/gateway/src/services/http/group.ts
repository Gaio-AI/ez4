import type { ArchitectureType, LogLevel, RuntimeType } from '@ez4/project';
import type { HttpListener } from './listener';
import type { HttpRequest } from './request';

// Merged into `Http` here instead of declared in `contract.ts`, which is part of the package's runtime build:
// any type there renames its minified identifiers, and so changes the bytes of every HTTP function bundle.
declare module './contract' {
  namespace Http {
    export type Group<T extends Request = Request> = HttpGroup<T>;

    interface Service {
      /**
       * Function settings of each route group, by the name routes give in `group`.
       *
       * - Only a group whose function differs from `defaults` needs an entry.
       */
      readonly groups?: Record<string, Group<any>>;
    }
  }
}

/**
 * Function settings of a route group.
 *
 * - Routes with the same `group` share one function, one log group and one integration.
 * - Each setting falls back to the service `defaults`, then to the project defaults.
 * - A route of the group may declare a setting only with the value the group resolves.
 */
export interface HttpGroup<T extends HttpRequest> {
  /**
   * Life‑cycle listener for all routes of the group.
   */
  readonly listener?: HttpListener<T>;

  /**
   * Number of days the group's logs are retained.
   */
  readonly logRetention?: number;

  /**
   * Log level of the group's function.
   */
  readonly logLevel?: LogLevel;

  /**
   * CPU architecture of the group's function.
   */
  readonly architecture?: ArchitectureType;

  /**
   * Runtime of the group's function.
   */
  readonly runtime?: RuntimeType;

  /**
   * Maximum execution time (in seconds) for every route of the group.
   */
  readonly timeout?: number;

  /**
   * Amount of memory (in MB) of the group's function.
   */
  readonly memory?: number;

  /**
   * Additional files to include in the group's bundle.
   */
  readonly files?: string[];

  /**
   * Enables debug mode for the group's function.
   */
  readonly debug?: boolean;

  /**
   * Enables VPC access for the group's function.
   *
   * - The function also runs in the VPC when a route's linked services need it.
   */
  readonly vpc?: boolean;
}
