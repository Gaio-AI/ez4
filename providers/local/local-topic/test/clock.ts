import type { TestContext } from 'node:test';

const MAX_TIMEOUT = 2 ** 31 - 1;

export type TestClock = {
  waitForTimer: () => Promise<boolean>;
  runNextTimer: () => Promise<boolean>;
};

const getTimerDelay = (delay?: number) => {
  return delay !== undefined && delay >= 1 && delay <= MAX_TIMEOUT ? delay : 1;
};

const isPackageTimer = () => {
  return !!new Error().stack?.includes('/local-topic/src/');
};

// Lets promise and I/O callbacks run while the timers are mocked.
export const waitFor = async (condition: () => boolean, turns = 1000) => {
  for (let turn = 0; turn < turns && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// Only the timers created by the package code are mocked. fetch keeps timers of its own across tests,
// and clearing one of them on the mocked timers of another test removes an unrelated timer.
// Mocked timers also run their callbacks with the clock already at the end of the tick, so the clock
// moves straight to the next timer and its callback sees the time it was scheduled for.
export const useTestClock = (t: TestContext): TestClock => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });

  const mockedSetTimeout = globalThis.setTimeout;
  const mockedClearTimeout = globalThis.clearTimeout;

  const pendingTimers = new Map<unknown, number>();
  const mockedTimers = new WeakSet<object>();

  t.mock.method(globalThis, 'setTimeout', (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (!isPackageTimer()) {
      return realSetTimeout(callback, delay, ...args);
    }

    const timer = mockedSetTimeout(
      (...inputs: unknown[]) => {
        pendingTimers.delete(timer);
        callback(...inputs);
      },
      delay,
      ...args
    );

    pendingTimers.set(timer, Date.now() + getTimerDelay(delay));
    mockedTimers.add(timer);

    return timer;
  });

  t.mock.method(globalThis, 'clearTimeout', (timer?: NodeJS.Timeout | string | number) => {
    if (typeof timer !== 'object' || !mockedTimers.has(timer)) {
      return realClearTimeout(timer);
    }

    pendingTimers.delete(timer);
    mockedClearTimeout(timer);
  });

  const waitForTimer = async () => {
    await waitFor(() => pendingTimers.size > 0);

    return pendingTimers.size > 0;
  };

  return {
    waitForTimer,
    runNextTimer: async () => {
      if (!(await waitForTimer())) {
        return false;
      }

      t.mock.timers.tick(Math.min(...pendingTimers.values()) - Date.now());

      return true;
    }
  };
};
