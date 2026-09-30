import type { TestContext } from 'node:test';

const MAX_TIMEOUT = 2 ** 31 - 1;

const MAX_TIMER_RUNS = 5_000;

export type TestClock = {
  advance: (time: number) => Promise<void>;
};

const getTimerDelay = (delay?: number) => {
  return delay !== undefined && delay >= 1 && delay <= MAX_TIMEOUT ? delay : 1;
};

const flushCallbacks = () => {
  return new Promise((resolve) => setImmediate(resolve));
};

// Mocked timers run their callbacks with the clock already at the end of the tick, so the clock
// moves from one pending timer to the next and each callback sees the time it was scheduled for.
// Promise callbacks run between the ticks, the same way they run between real timers.
export const useTestClock = (t: TestContext, now: string): TestClock => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(now) });

  const mockedSetTimeout = globalThis.setTimeout;
  const mockedClearTimeout = globalThis.clearTimeout;

  const pendingTimers = new Map<unknown, number>();

  t.mock.method(globalThis, 'setTimeout', (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const timer = mockedSetTimeout(
      (...inputs: unknown[]) => {
        pendingTimers.delete(timer);
        callback(...inputs);
      },
      delay,
      ...args
    );

    pendingTimers.set(timer, Date.now() + getTimerDelay(delay));

    return timer;
  });

  t.mock.method(globalThis, 'clearTimeout', (timer?: NodeJS.Timeout) => {
    pendingTimers.delete(timer);
    mockedClearTimeout(timer);
  });

  const getNextTime = () => {
    return Math.min(...pendingTimers.values());
  };

  return {
    advance: async (time: number) => {
      const targetTime = Date.now() + time;

      for (let nextTime = getNextTime(), runs = 0; nextTime <= targetTime; nextTime = getNextTime(), runs++) {
        if (runs === MAX_TIMER_RUNS) {
          throw new Error(`Timers are still firing after ${MAX_TIMER_RUNS} runs.`);
        }

        t.mock.timers.tick(nextTime - Date.now());

        await flushCallbacks();
      }

      t.mock.timers.tick(targetTime - Date.now());

      await flushCallbacks();
    }
  };
};
