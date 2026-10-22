import type { AnyObject } from '@ez4/utils';

/**
 * The key a subscription runs a message once by: its handler and the values of the key fields, in a form where
 * no two different value lists meet (a separator could appear inside a value).
 */
export const getIdempotencyKey = (handlerName: string, message: AnyObject, keyFields: string[]) => {
  return JSON.stringify([handlerName, ...keyFields.map((fieldName) => message[fieldName])]);
};

/**
 * Whether a handler failed with `UnknownOutcomeError`, by name: the runtime and the handler may each bundle a
 * copy of the class.
 */
export const isUnknownOutcomeError = (error: unknown) => {
  return error instanceof Error && error.name === 'UnknownOutcomeError';
};
