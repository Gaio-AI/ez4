import type { AnyObject } from '@ez4/utils';

import { AsyncLocalStorage } from 'node:async_hooks';

export type EmulatorInvocation = {
  /**
   * Client of each overridden resource, by service identifier.
   */
  services: Record<string, unknown>;

  /**
   * Identity a route behind an authorizer receives without running the authorizer.
   */
  identity?: AnyObject;
};

// Registered on the process, so the CLI bundle that makes the handler clients and the library bundle the testers
// run from share the invocation of a request.
const INVOCATION_STORAGE: unique symbol = Symbol.for('@ez4/project:invocation');

type InvocationGlobal = typeof globalThis & {
  [INVOCATION_STORAGE]?: AsyncLocalStorage<EmulatorInvocation>;
};

const getInvocationStorage = () => {
  const globalObject: InvocationGlobal = globalThis;

  return (globalObject[INVOCATION_STORAGE] ??= new AsyncLocalStorage());
};

/**
 * Run the given callback in the given invocation, which reaches everything the callback runs or awaits.
 */
export const runWithInvocation = <T>(invocation: EmulatorInvocation, callback: () => T) => {
  return getInvocationStorage().run(invocation, callback);
};

/**
 * Get the invocation of the current async context.
 */
export const getCurrentInvocation = () => {
  return getInvocationStorage().getStore();
};
