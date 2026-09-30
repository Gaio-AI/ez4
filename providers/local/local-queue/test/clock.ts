import type { TestContext } from 'node:test';

export type TestClock = {
  advance: (milliseconds: number) => Promise<void>;
  pendingTimers: () => number;
};

export type TestClockOptions = {
  date?: boolean;
};

const PACKAGE_SOURCE = '/local-queue/src/';

// Lets promise and I/O callbacks run while the timers are mocked.
export const waitFor = async (condition: () => boolean, turns = 10000) => {
  for (let turn = 0; turn < turns && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const flush = () => {
  return waitFor(() => false, 200);
};

// Gives pending callbacks some turns and a few real milliseconds to run, before asserting that
// something didn't happen.
export const settle = async () => {
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await flush();
};

const isPackageTimer = () => {
  const stackLimit = Error.stackTraceLimit;

  Error.stackTraceLimit = 30;

  const frames = new Error().stack?.split('\n').slice(1) ?? [];

  Error.stackTraceLimit = stackLimit;

  // The first frame out of this file and the mock wrapper is the code that created the timer.
  const caller = frames.find((frame) => !frame.includes('/test/clock.ts') && !frame.includes('node:internal/test_runner'));

  return !!caller?.includes(PACKAGE_SOURCE);
};

// Only the timers the package creates are mocked: fetch keeps timers of its own across tests, and
// one of them left on the mocked timers never fires again once the test ends.
export const useTestClock = (t: TestContext, options?: TestClockOptions): TestClock => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  t.mock.timers.enable({
    apis: options?.date === false ? ['setTimeout'] : ['setTimeout', 'Date'],
    now: 0
  });

  const mockedSetTimeout = globalThis.setTimeout;
  const mockedClearTimeout = globalThis.clearTimeout;

  const pendingTimers = new Map<object, number>();
  const mockedTimers = new WeakSet<object>();

  let currentTime = 0;

  t.mock.method(globalThis, 'setTimeout', (callback: (...inputs: unknown[]) => void, delay?: number, ...inputs: unknown[]) => {
    if (!isPackageTimer()) {
      return realSetTimeout(callback, delay, ...inputs);
    }

    const timer = mockedSetTimeout(
      (...values: unknown[]) => {
        pendingTimers.delete(timer);
        callback(...values);
      },
      delay,
      ...inputs
    );

    pendingTimers.set(timer, currentTime + Math.max(0, delay ?? 0));
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

  const tick = (milliseconds: number) => {
    currentTime += milliseconds;
    t.mock.timers.tick(milliseconds);
  };

  return {
    pendingTimers: () => pendingTimers.size,
    advance: async (milliseconds: number) => {
      const targetTime = currentTime + milliseconds;

      await flush();

      // Timers run one due time at a time, so what a callback schedules in between still runs in order.
      for (let nextTime = Math.min(...pendingTimers.values()); nextTime <= targetTime; nextTime = Math.min(...pendingTimers.values())) {
        tick(Math.max(0, nextTime - currentTime));

        await flush();
      }

      tick(targetTime - currentTime);

      await flush();
    }
  };
};
