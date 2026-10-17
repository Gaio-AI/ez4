import { deepEqual, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { runInTransactionOrder } from '../../src/service/utils/order';

describe('transaction order utils', () => {
  const makeOperation = (events: string[], name: string, fails = false) => {
    return async () => {
      events.push(`${name}:start`);

      await setImmediate();

      events.push(`${name}:end`);

      if (fails) {
        throw new Error(name);
      }

      return name;
    };
  };

  it('assert :: operations of one transaction run one after the other', async () => {
    const events: string[] = [];

    const results = await Promise.all([
      runInTransactionOrder('tx-1', makeOperation(events, 'a')),
      runInTransactionOrder('tx-1', makeOperation(events, 'b'))
    ]);

    deepEqual(results, ['a', 'b']);
    deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('assert :: a failed operation lets the next one run', async () => {
    const events: string[] = [];

    const failed = runInTransactionOrder('tx-1', makeOperation(events, 'a', true));
    const next = runInTransactionOrder('tx-1', makeOperation(events, 'b'));

    await rejects(failed, { message: 'a' });

    deepEqual(await next, 'b');
    deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('assert :: operations of different transactions or none run together', async () => {
    const events: string[] = [];

    await Promise.all([
      runInTransactionOrder('tx-1', makeOperation(events, 'a')),
      runInTransactionOrder('tx-2', makeOperation(events, 'b')),
      runInTransactionOrder(undefined, makeOperation(events, 'c'))
    ]);

    // Every operation starts before any of them ends.
    deepEqual(events.slice(0, 3).sort(), ['a:start', 'b:start', 'c:start']);
  });
});
