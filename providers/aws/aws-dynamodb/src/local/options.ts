import type { DatabaseService } from '@ez4/database/library';
import type { ServeOptions } from '@ez4/project/library';

import { isAnyBoolean, isAnyNumber, isEmptyObject, toSnakeCase } from '@ez4/utils';

import { LocalOptionInvalidError, LocalOptionsNotFoundError } from './errors';

export type TimeToLiveOptions = {
  enabled: boolean;
  interval: number;
};

// Node timers fire right away for delays above 2^31-1 milliseconds.
const MAX_TIMER_SECONDS = Math.floor((2 ** 31 - 1) / 1000);

export const getConnectionOptions = (service: DatabaseService, options: ServeOptions) => {
  const { host = 'localhost', port = 8000 } = getServiceOptions(service, options);

  return {
    endpoint: `http://${host}:${port}`
  };
};

export const getTimeToLiveOptions = (service: DatabaseService, options: ServeOptions): TimeToLiveOptions => {
  const { ttlSweeper = true, ttlInterval = 30 } = getServiceOptions(service, options);

  if (!isAnyBoolean(ttlSweeper)) {
    throw new LocalOptionInvalidError('ttlSweeper', service.name, 'a boolean');
  }

  if (!isAnyNumber(ttlInterval) || ttlInterval <= 0 || ttlInterval > MAX_TIMER_SECONDS) {
    throw new LocalOptionInvalidError('ttlInterval', service.name, `a number of seconds between 0 and ${MAX_TIMER_SECONDS}`);
  }

  return {
    enabled: ttlSweeper,
    interval: ttlInterval
  };
};

const getServiceOptions = (service: DatabaseService, options: ServeOptions) => {
  const optionsName = toSnakeCase(service.name);

  const serviceOptions = {
    ...options.localOptions[optionsName],
    ...(options.test && options.testOptions[optionsName])
  };

  if (isEmptyObject(serviceOptions)) {
    throw new LocalOptionsNotFoundError(optionsName, service.name);
  }

  return serviceOptions;
};
