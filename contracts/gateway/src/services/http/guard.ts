import type { Service } from '@ez4/common';
import type { HttpProvider } from './provider';
import type { HttpIncoming } from './incoming';
import type { HttpRequest } from './request';
import type { Http } from './contract';

// Merged into `Http` here instead of declared in `contract.ts`, which is part of the package's runtime build:
// any type there renames its minified identifiers, and so changes the bytes of every HTTP function bundle.
declare module './contract' {
  namespace Http {
    export type Allow = HttpAllow;
    export type Guard<T extends Request = Request> = HttpGuard<T>;
  }
}

export type HttpAllowValue = string | number | boolean;

/**
 * What a route allows, as its guard reads it.
 *
 * - A literal value: a string, number or boolean, a tuple of them, or an object of either.
 * - An enum member stands for its value, so `[Role.Reader, Role.Writer]` reaches the guard as `['reader', 'writer']`.
 * - Not recursive, since the reflection would expand a recursive alias without end.
 */
export type HttpAllow =
  | HttpAllowValue
  | readonly HttpAllowValue[]
  | { readonly [name: string]: HttpAllowValue | readonly HttpAllowValue[] };

/**
 * HTTP route guard.
 *
 * - Runs inside the route's function, after the request is validated (identity included) and right before the handler.
 * - Receives the route's `allow` as declared: what it means is up to the guard, which types it in its second parameter.
 * - Throwing refuses the request, the same way an error thrown by the handler does.
 */
export type HttpGuard<T extends HttpRequest> = (
  request: HttpIncoming<T>,
  allow: any,
  context: Service.Context<Http.Service | HttpProvider>
) => Promise<void> | void;
