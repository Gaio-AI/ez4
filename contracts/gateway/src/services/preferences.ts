import type { NamingStyle } from '@ez4/schema';

/**
 * Preferences configuration.
 */
export interface WebPreferences {
  /**
   * Determines the naming style for the query strings and body payloads.
   */
  readonly namingStyle?: NamingStyle;

  /**
   * Determines whether a query string the request doesn't declare fails the request with
   * a bad request error instead of being dropped (only HTTP routes apply it).
   */
  readonly strictQueryStrings?: boolean;
}
