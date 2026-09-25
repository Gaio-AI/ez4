import { AsyncLocalStorage } from 'node:async_hooks';

import { getRandomUUID } from '@ez4/utils';

/**
 * Determines whether or not the handler is running in a debug runtime.
 * !! IT MUST BE DEFINED BY THE BUNDLER !!
 */
declare const EZ4_IS_DEBUG_RUNTIME: boolean;

/**
 * Determines whether or not the handler is running at a remote runtime.
 * !! IT MUST BE DEFINED BY THE BUNDLER !!
 */
declare const EZ4_IS_REMOTE_RUNTIME: boolean;

/**
 * Hold the handler's runtime resource name.
 * !! IT MUST BE DEFINED BY THE BUNDLER !!
 */
declare const EZ4_RESOURCE_NAME: string;

/**
 * Access to the current runtime settings.
 */
export namespace Runtime {
  type ScopeState = {
    scope?: Scope;
    headers: ScopeHeaders;
  };

  const scopeStorage = new AsyncLocalStorage<ScopeState>();

  const globalState: ScopeState = {
    headers: {}
  };

  const getScopeState = () => {
    return scopeStorage.getStore() ?? globalState;
  };

  export type Scope = { traceId: string } & { [key: string]: string | undefined };

  export type ScopeHeaders = Record<string, string>;

  export type ScopeSource = Record<string, string | undefined> | null | undefined;

  export const MAX_SCOPE_VALUE_LENGTH = 256;

  /**
   * Set the new runtime scope, the one of the current `runWithScope` callback or the common one.
   *
   * @param scope New scope object.
   * @param headers Header name of each scope key, used to forward the scope.
   */
  export const setScope = (scope: Scope, headers: ScopeHeaders = {}) => {
    const state = getScopeState();

    state.scope = { ...scope };
    state.headers = { ...headers };
  };

  /**
   * Clear the runtime scope and its headers.
   */
  export const clearScope = () => {
    const state = getScopeState();

    state.scope = undefined;
    state.headers = {};
  };

  /**
   * Run the given callback in a scope of its own, which takes the place of the common scope for
   * everything the callback runs or awaits, so concurrent callbacks don't share one scope.
   *
   * @param callback Callback to run, which sets its scope with `setScope` or `importScope`.
   * @returns Returns the callback result.
   */
  export const runWithScope = <T>(callback: () => T) => {
    return scopeStorage.run({ headers: {} }, callback);
  };

  /**
   * Get the current runtime scope.
   *
   * @returns Returns the scope of the current `runWithScope` callback, or the common scope.
   */
  export const getScope = () => {
    return getScopeState().scope;
  };

  /**
   * Get the header name of each key in the current scope.
   *
   * @returns Returns the scope headers map (empty when none is declared).
   */
  export const getScopeHeaders = () => {
    return getScopeState().headers;
  };

  /**
   * Read the declared scope headers from the given sources.
   *
   * @param headers Header name of each scope key.
   * @param sources Header or query maps with lowercase keys, in priority order.
   * @returns Returns the non-empty scope values found, truncated to `MAX_SCOPE_VALUE_LENGTH`.
   */
  export const readScopeValues = (headers: ScopeHeaders | null | undefined, ...sources: ScopeSource[]) => {
    const values: Record<string, string> = {};

    for (const [key, header] of Object.entries(headers ?? {})) {
      const name = header.toLowerCase();
      const value = sources.find((source) => !!source?.[name])?.[name];

      if (value) {
        values[key] = value.slice(0, MAX_SCOPE_VALUE_LENGTH);
      }
    }

    return values;
  };

  /**
   * Read the client trace id from the given sources.
   *
   * @param sources Header or query maps with lowercase keys, in priority order.
   * @returns Returns the first non-empty `x-trace-id` truncated to `MAX_SCOPE_VALUE_LENGTH`, or a new one.
   */
  export const readTraceId = (...sources: ScopeSource[]) => {
    const traceId = sources.find((source) => !!source?.['x-trace-id'])?.['x-trace-id'];

    return traceId?.slice(0, MAX_SCOPE_VALUE_LENGTH) ?? getRandomUUID();
  };

  /**
   * Get the request headers that forward the current scope.
   *
   * @returns Returns the `X-Trace-Id` header (a new one without scope) and each declared scope header.
   */
  export const getScopeRequestHeaders = () => {
    const { scope, headers: scopeHeaders } = getScopeState();

    const headers: Record<string, string> = {
      ['X-Trace-Id']: scope?.traceId ?? getRandomUUID()
    };

    for (const [key, header] of Object.entries(scopeHeaders)) {
      const value = scope?.[key];

      if (value !== undefined) {
        headers[header] = value;
      }
    }

    return headers;
  };

  /**
   * Serialize the current scope (without `traceId`) and its headers.
   *
   * @returns Returns the serialized scope, or `undefined` when it has no extra values.
   */
  export const exportScope = () => {
    const { scope, headers } = getScopeState();

    const values = { ...scope, traceId: undefined };

    if (!Object.values(values).some((value) => value !== undefined)) {
      return undefined;
    }

    return JSON.stringify({
      values,
      headers
    });
  };

  /**
   * Restore the scope serialized by `exportScope`.
   *
   * @param traceId Trace Id of the restored scope.
   * @param raw Serialized scope, missing or invalid payloads restore `traceId` only.
   */
  export const importScope = (traceId: string, raw: string | undefined) => {
    const { values, headers } = parseScope(raw);
    const scopeValues: Record<string, string> = {};

    for (const key in headers) {
      if (Object.hasOwn(values, key)) {
        scopeValues[key] = values[key].slice(0, MAX_SCOPE_VALUE_LENGTH);
      }
    }

    setScope({ ...scopeValues, traceId }, headers);
  };

  const parseScope = (raw: string | undefined) => {
    try {
      const { values, headers } = JSON.parse(raw ?? '');

      return {
        values: getStringRecord(values),
        headers: getStringRecord(headers)
      };
    } catch {
      return {
        values: {},
        headers: {}
      };
    }
  };

  const getStringRecord = (input: unknown): Record<string, string> => {
    if (!input || typeof input !== 'object') {
      return {};
    }

    return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === 'string'));
  };

  /**
   * Get the runtime resource name.
   *
   * @returns Returns the resource name.
   */
  export const getResourceName = () => {
    return typeof EZ4_RESOURCE_NAME === 'string' ? EZ4_RESOURCE_NAME : 'unknown';
  };

  /**
   * Check whether the current runtime is debug.
   *
   * @returns Returns `true` when the current runtime is debug, `false` otherwise.
   */
  export const isDebug = () => {
    return typeof EZ4_IS_DEBUG_RUNTIME !== 'undefined' && !!EZ4_IS_DEBUG_RUNTIME;
  };

  /**
   * Check whether the current runtime is remote.
   *
   * @returns Returns `true` when the current runtime is remote, `false` otherwise.
   */
  export const isRemote = () => {
    return typeof EZ4_IS_REMOTE_RUNTIME !== 'undefined' && !!EZ4_IS_REMOTE_RUNTIME;
  };

  /**
   * Check whether the current runtime is local.
   *
   * @returns Returns `true` when the current runtime is local, `false` otherwise.
   */
  export const isLocal = () => {
    return !isRemote();
  };
}
