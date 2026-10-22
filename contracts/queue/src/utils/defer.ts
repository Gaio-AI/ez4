import type { AnyObject } from '@ez4/utils';

import { getRandomInteger } from '@ez4/utils';

/**
 * Most times a message is deferred, each wait counting once, before it fails like with an error.
 */
export const MaxDeferCount = 20;

/**
 * Longest wait (in seconds) a queue takes for one message; a longer defer is made of waits this long.
 */
export const MaxDeferDelay = 900;

/**
 * The key of one concurrency slot of a subscription: its handler, the values of the key fields and the slot. An
 * object, so it never meets an idempotency key, which is a list.
 */
export const getConcurrencySlotKey = (handlerName: string, message: AnyObject, keyFields: string[], slot: number) => {
  return JSON.stringify({ handler: handlerName, key: keyFields.map((fieldName) => message[fieldName]), slot });
};

/**
 * Delay (in seconds) before a message without a free slot comes back, spread so the messages of one key don't
 * all come back at the same time.
 */
export const getSlotWaitDelay = () => {
  return getRandomInteger(5, 30);
};
