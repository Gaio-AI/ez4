// Node runs a timeout longer than this right away, so longer delays are chained in chunks.
const MAX_TIMEOUT_DELAY = 2 ** 31 - 1;

export type TimeoutHandle = {
  cancel: () => void;
};

export const createTimeout = (callback: () => void, delay: number): TimeoutHandle => {
  let timeout: NodeJS.Timeout | undefined;

  const scheduleTimeout = (remaining: number) => {
    const current = Math.min(remaining, MAX_TIMEOUT_DELAY);

    timeout = setTimeout(() => {
      if (remaining > current) {
        return scheduleTimeout(remaining - current);
      }

      callback();
    }, current);
  };

  scheduleTimeout(Math.max(delay, 0));

  return {
    cancel: () => clearTimeout(timeout)
  };
};
