import type { EntrypointSource } from '@ez4/project/library';

import { Logger } from '@ez4/logger';

// Timeout (in seconds) of a route without its own or a default one, as the AWS gateway deploys it.
const DEFAULT_TIMEOUT = 30;

export type LambdaTimeoutOptions = {
  timeout: number;
  source: EntrypointSource;
  onTimeout: () => unknown;
};

export class LambdaTimeoutError extends Error {
  constructor(public timeout: number) {
    super(`Lambda timed out after ${timeout} seconds.`);
  }
}

// The Lambda of a route (and of its authorizer) gets a second less than the route, and 5 seconds at least.
export const getLambdaTimeout = (timeout: number | undefined) => {
  return Math.max(5, (timeout ?? DEFAULT_TIMEOUT) - 1);
};

// A handler can't be stopped in the same process, so past the deadline it keeps running and what it returns later
// is dropped, while the invocation fails with `LambdaTimeoutError` as the Lambda would.
export const runWithLambdaTimeout = <T>(options: LambdaTimeoutOptions, invocation: () => Promise<T>) => {
  const { timeout, source, onTimeout } = options;

  const headline = `⏱️  ${source.file}:${source.position.join(':')} [${source.name}]`;

  return new Promise<T>((resolve, reject) => {
    let expired = false;

    const emitTimeout = async () => {
      try {
        await onTimeout();
      } catch (error) {
        Logger.error(`${headline} ${error}`);
      }
    };

    const expire = () => {
      expired = true;

      Logger.warn(`${headline} Exceeded the Lambda timeout of ${timeout} seconds, the handler keeps running`);

      reject(new LambdaTimeoutError(timeout));
    };

    // As the gateway runtime, the timeout event comes a second before the deadline.
    const timeoutTimer = setTimeout(emitTimeout, (timeout - 1) * 1000);
    const deadlineTimer = setTimeout(expire, timeout * 1000);

    const settle = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(deadlineTimer);

      if (expired) {
        Logger.warn(`${headline} Finished after the Lambda timeout, its result is discarded`);
      }

      return !expired;
    };

    invocation().then(
      (result) => {
        if (settle()) {
          resolve(result);
        }
      },
      (error) => {
        if (settle()) {
          reject(error);
        }
      }
    );
  });
};
