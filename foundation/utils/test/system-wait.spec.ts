import type { TestContext } from 'node:test';

import { ok, equal, deepEqual } from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { scheduler } from 'node:timers/promises';

import { WaitMaxAttemptsError, Wait } from '@ez4/utils';
import { rejects } from 'node:assert';

// `Wait.until` sleeps through `scheduler.wait`: the tests record each delay it asks for instead of waiting it.
const recordWaits = (t: TestContext) => {
  const waits: number[] = [];

  t.mock.method(scheduler, 'wait', async (delay: number) => {
    waits.push(delay);
  });

  return waits;
};

describe('system wait utils', () => {
  it('assert :: wait until (success)', async (t) => {
    const waits = recordWaits(t);
    const callback = mock.fn(() => true);

    const result = await Wait.until(callback);

    equal(callback.mock.callCount(), 1);
    deepEqual(waits, []);

    ok(result);
  });

  it('assert :: wait until (partial failure)', async (t) => {
    const waits = recordWaits(t);
    const callback = mock.fn((current, maximum) => (current < maximum ? Wait.RetryAttempt : true));

    const result = await Wait.until(callback, {
      attempts: 3,
      minDelay: 1,
      maxDelay: 5
    });

    equal(callback.mock.callCount(), 3);
    equal(waits.length, 2);
    ok(
      waits.every((delay) => delay >= 1000 && delay <= 5000),
      `${waits}`
    );

    ok(result);
  });

  it('assert :: wait until (failure)', async (t) => {
    const waits = recordWaits(t);
    const callback = mock.fn((): Wait.Result<boolean> => Wait.RetryAttempt);

    await rejects(() => Wait.until(callback, { attempts: 2 }), WaitMaxAttemptsError);

    equal(callback.mock.callCount(), 2);
    equal(waits.length, 2);
    ok(
      waits.every((delay) => delay >= 0 && delay <= 90000),
      `${waits}`
    );
  });

  it('assert :: retry delay (random time with boundaries)', async () => {
    const maxDelay = 120;
    const minDelay = 5;

    for (let counter = 0; counter < 100; counter++) {
      const first = Wait.delay(1, 3, minDelay, maxDelay);
      const second = Wait.delay(2, 3, minDelay, maxDelay);
      const third = Wait.delay(3, 3, minDelay, maxDelay);

      ok(first >= 5 && first <= 44);
      ok(second >= 24 && second <= 82);
      ok(third >= 43 && third <= 120);

      // Test retries overflow
      const overflow = Wait.delay(4, 3, minDelay, maxDelay);

      ok(overflow >= 44 && overflow <= 120);
    }
  });

  it('assert :: retry delay (constant time)', async () => {
    const minDelay = 5;
    const maxDelay = 5;

    for (let counter = 0; counter < 100; counter++) {
      equal(Wait.delay(1, 3, minDelay, maxDelay), 5);
      equal(Wait.delay(2, 3, minDelay, maxDelay), 5);
      equal(Wait.delay(3, 3, minDelay, maxDelay), 5);

      // Test retries overflow
      equal(Wait.delay(4, 3, minDelay, maxDelay), 5);
    }
  });
});
