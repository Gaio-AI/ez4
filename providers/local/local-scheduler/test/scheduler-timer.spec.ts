import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { CronService } from '@ez4/scheduler/library';
import type { TestContext } from 'node:test';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { registerLocalService } from '../src/provider/local';
import { InMemoryScheduler } from '../src/service/scheduler';
import { useTestClock } from './clock';

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

type RunCase = {
  expression: string;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  now: string;
  period: number;
  runs: string[];
};

const options = {
  prefix: 'ez4',
  projectName: 'timer',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {},
  suppress: false
} as ServeOptions;

const context = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

const getCronService = (name: string, properties: Partial<CronService>) => {
  return {
    type: '@ez4/scheduler',
    name,
    services: {},
    variables: {},
    target: {
      handler: {
        name: 'probeScope',
        file: 'test/fixtures/scope-probe.ts',
        position: [1, 1]
      }
    },
    ...properties
  } as unknown as CronService;
};

type RunHandler = () => Promise<void> | void;

const startScheduler = (service: CronService, handler?: RunHandler) => {
  const runs: string[] = [];

  const scheduler = registerLocalService(service, options, context);

  scheduler.bootstrapHandler();

  InMemoryScheduler.getScheduler(service.name).handler = () => {
    runs.push(new Date().toISOString());
    return handler?.();
  };

  return { scheduler, runs };
};

const collectRuns = async (t: TestContext, service: CronService, now: string, period: number, handler?: RunHandler) => {
  const clock = useTestClock(t, now);

  const { scheduler, runs } = startScheduler(service, handler);

  try {
    await clock.advance(period);
  } finally {
    scheduler.shutdownHandler();
  }

  return runs;
};

const getWarnings = (warn: { mock: { calls: { arguments: unknown[] }[] } }, resourceName: string) => {
  return warn.mock.calls.filter(({ arguments: [message] }) => `${message}`.includes(`[${resourceName}]`));
};

const describeRunCases = (prefix: string, cases: RunCase[]) => {
  cases.forEach(({ now, period, runs, ...properties }, index) => {
    const { expression, timezone, startDate, endDate } = properties;

    const details = [timezone, startDate && `from ${startDate}`, endDate && `until ${endDate}`].filter(Boolean).join(' ');

    it(`assert :: ${expression}${details && ` (${details})`}`, async (t) => {
      const service = getCronService(`${prefix}${index}`, properties);

      deepEqual(await collectRuns(t, service, now, period), runs);
    });
  });
};

describe('local scheduler timers', () => {
  describe('timezone', () => {
    describeRunCases('timezone', [
      {
        expression: 'cron(0 10 * * ? *)',
        now: '2026-09-29T00:00:00Z',
        period: ONE_DAY,
        runs: ['2026-09-29T10:00:00.000Z']
      },
      {
        expression: 'cron(0 10 * * ? *)',
        timezone: 'Asia/Tokyo',
        now: '2026-09-29T00:00:00Z',
        period: ONE_DAY,
        runs: ['2026-09-29T01:00:00.000Z']
      },
      {
        expression: 'cron(0 10 * * ? *)',
        timezone: 'America/Sao_Paulo',
        now: '2026-09-29T00:00:00Z',
        period: ONE_DAY,
        runs: ['2026-09-29T13:00:00.000Z']
      },
      {
        expression: 'cron(0 1 ? * 2 *)',
        timezone: 'Asia/Tokyo',
        now: '2026-09-29T00:00:00Z',
        period: 7 * ONE_DAY,
        runs: ['2026-10-04T16:00:00.000Z']
      },
      {
        expression: 'cron(0 5 1 1 ? 2027)',
        timezone: 'Asia/Tokyo',
        now: '2026-12-30T00:00:00Z',
        period: 3 * ONE_DAY,
        runs: ['2026-12-31T20:00:00.000Z']
      },
      {
        expression: 'at(2026-09-29T10:00:00)',
        now: '2026-09-29T00:00:00Z',
        period: ONE_DAY,
        runs: ['2026-09-29T10:00:00.000Z']
      },
      {
        expression: 'at(2026-09-29T10:00:00)',
        timezone: 'America/Sao_Paulo',
        now: '2026-09-29T00:00:00Z',
        period: ONE_DAY,
        runs: ['2026-09-29T13:00:00.000Z']
      },
      {
        expression: 'at(2026-09-29T10:00:00)',
        timezone: 'Asia/Tokyo',
        now: '2026-09-29T00:00:00Z',
        period: ONE_DAY,
        runs: ['2026-09-29T01:00:00.000Z']
      }
    ]);
  });

  describe('day of week', () => {
    describeRunCases('dayOfWeek', [
      {
        expression: 'cron(0 12 ? * 2 *)',
        now: '2026-09-29T00:00:00Z',
        period: 14 * ONE_DAY,
        runs: ['2026-10-05T12:00:00.000Z', '2026-10-12T12:00:00.000Z']
      },
      {
        expression: 'cron(0 12 ? * 1,7 *)',
        now: '2026-09-29T00:00:00Z',
        period: 7 * ONE_DAY,
        runs: ['2026-10-03T12:00:00.000Z', '2026-10-04T12:00:00.000Z']
      },
      {
        expression: 'cron(0 12 ? * 2-3 *)',
        now: '2026-09-29T00:00:00Z',
        period: 7 * ONE_DAY,
        runs: ['2026-09-29T12:00:00.000Z', '2026-10-05T12:00:00.000Z']
      },
      {
        expression: 'cron(0 12 ? * 2#1 *)',
        now: '2026-09-29T00:00:00Z',
        period: 62 * ONE_DAY,
        runs: ['2026-10-05T12:00:00.000Z', '2026-11-02T12:00:00.000Z']
      },
      {
        expression: 'cron(0 12 ? * 6L *)',
        now: '2026-09-29T00:00:00Z',
        period: 62 * ONE_DAY,
        runs: ['2026-10-30T12:00:00.000Z', '2026-11-27T12:00:00.000Z']
      },
      {
        expression: 'cron(0 12 ? * 2/3 *)',
        now: '2026-09-29T00:00:00Z',
        period: 7 * ONE_DAY,
        runs: ['2026-10-01T12:00:00.000Z', '2026-10-05T12:00:00.000Z']
      },
      {
        expression: 'cron(0 12 ? * L *)',
        now: '2026-09-29T00:00:00Z',
        period: 7 * ONE_DAY,
        runs: ['2026-10-03T12:00:00.000Z']
      },
      {
        expression: 'cron(0 12 ? * MON-FRI *)',
        now: '2026-09-29T00:00:00Z',
        period: 7 * ONE_DAY,
        runs: [
          '2026-09-29T12:00:00.000Z',
          '2026-09-30T12:00:00.000Z',
          '2026-10-01T12:00:00.000Z',
          '2026-10-02T12:00:00.000Z',
          '2026-10-05T12:00:00.000Z'
        ]
      }
    ]);
  });

  describe('day of month', () => {
    describeRunCases('dayOfMonth', [
      {
        expression: 'cron(0 10 15W * ? *)',
        now: '2026-10-01T00:00:00Z',
        period: 47 * ONE_DAY,
        runs: ['2026-10-15T10:00:00.000Z', '2026-11-16T10:00:00.000Z']
      },
      {
        expression: 'cron(0 10 1W * ? *)',
        now: '2027-04-15T00:00:00Z',
        period: 30 * ONE_DAY,
        runs: ['2027-05-03T10:00:00.000Z']
      },
      {
        expression: 'cron(0 10 31W * ? *)',
        now: '2027-01-15T00:00:00Z',
        period: 20 * ONE_DAY,
        runs: ['2027-01-29T10:00:00.000Z']
      },
      {
        expression: 'cron(0 10 LW * ? *)',
        now: '2026-10-01T00:00:00Z',
        period: 152 * ONE_DAY,
        runs: [
          '2026-10-30T10:00:00.000Z',
          '2026-11-30T10:00:00.000Z',
          '2026-12-31T10:00:00.000Z',
          '2027-01-29T10:00:00.000Z',
          '2027-02-26T10:00:00.000Z'
        ]
      },
      {
        expression: 'cron(0 10 L * ? *)',
        now: '2026-10-01T00:00:00Z',
        period: 62 * ONE_DAY,
        runs: ['2026-10-31T10:00:00.000Z', '2026-11-30T10:00:00.000Z']
      }
    ]);
  });

  describe('year', () => {
    describeRunCases('year', [
      {
        expression: 'cron(0 10 * * ? 2027)',
        now: '2026-12-30T00:00:00Z',
        period: 3 * ONE_DAY,
        runs: ['2027-01-01T10:00:00.000Z']
      },
      {
        expression: 'cron(0 10 1 1 ? 2027-2028)',
        now: '2026-09-29T00:00:00Z',
        period: 3 * 365 * ONE_DAY,
        runs: ['2027-01-01T10:00:00.000Z', '2028-01-01T10:00:00.000Z']
      },
      {
        expression: 'cron(0 10 1 1 ? 2027,2029)',
        now: '2026-09-29T00:00:00Z',
        period: 4 * 365 * ONE_DAY,
        runs: ['2027-01-01T10:00:00.000Z', '2029-01-01T10:00:00.000Z']
      },
      {
        expression: 'cron(0 10 1 1 ? 2027/2)',
        now: '2026-09-29T00:00:00Z',
        period: 4 * 365 * ONE_DAY,
        runs: ['2027-01-01T10:00:00.000Z', '2029-01-01T10:00:00.000Z']
      }
    ]);

    it('assert :: cron(0 10 * * ? 2020) never runs and warns once', async (t) => {
      const warn = t.mock.method(Logger, 'warn');

      const service = getCronService('yearExpired', {
        expression: 'cron(0 10 * * ? 2020)'
      });

      deepEqual(await collectRuns(t, service, '2026-09-29T00:00:00Z', 3 * ONE_DAY), []);

      equal(getWarnings(warn, 'yearExpired').length, 1);
    });
  });

  describe('start and end dates', () => {
    describeRunCases('startEnd', [
      {
        expression: 'cron(0 10 * * ? *)',
        startDate: '2026-10-01T10:00:00Z',
        endDate: '2026-10-03T10:00:00Z',
        now: '2026-09-29T00:00:00Z',
        period: 10 * ONE_DAY,
        runs: ['2026-10-01T10:00:00.000Z', '2026-10-02T10:00:00.000Z', '2026-10-03T10:00:00.000Z']
      },
      {
        expression: 'rate(1 day)',
        startDate: '2026-10-01T06:00:00Z',
        endDate: '2026-10-03T06:00:00Z',
        now: '2026-09-29T00:00:00Z',
        period: 10 * ONE_DAY,
        runs: ['2026-10-01T06:00:00.000Z', '2026-10-02T06:00:00.000Z', '2026-10-03T06:00:00.000Z']
      },
      {
        expression: 'rate(1 hour)',
        startDate: '2026-09-28T00:30:00Z',
        now: '2026-09-29T00:00:00Z',
        period: 3 * ONE_HOUR,
        runs: ['2026-09-29T00:30:00.000Z', '2026-09-29T01:30:00.000Z', '2026-09-29T02:30:00.000Z']
      },
      {
        expression: 'at(2026-09-29T10:00:00)',
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2026-10-02T00:00:00Z',
        now: '2026-09-29T00:00:00Z',
        period: 10 * ONE_DAY,
        runs: ['2026-09-29T10:00:00.000Z']
      }
    ]);

    it('assert :: cron past its end date warns once', async (t) => {
      const warn = t.mock.method(Logger, 'warn');

      const service = getCronService('endReached', {
        expression: 'cron(0 10 * * ? *)',
        endDate: '2026-09-30T10:00:00Z'
      });

      deepEqual(await collectRuns(t, service, '2026-09-29T00:00:00Z', 5 * ONE_DAY), [
        '2026-09-29T10:00:00.000Z',
        '2026-09-30T10:00:00.000Z'
      ]);

      equal(getWarnings(warn, 'endReached').length, 1);
    });
  });

  describe('long delays', () => {
    const assertLongDelay = (name: string, expression: string, now: string, runDate: string) => {
      it(`assert :: ${expression} runs on ${runDate}`, async (t) => {
        const clock = useTestClock(t, now);

        const { scheduler, runs } = startScheduler(getCronService(name, { expression }));

        try {
          const delay = Date.parse(runDate) - Date.parse(now);

          await clock.advance(ONE_SECOND);
          equal(runs.length, 0);

          await clock.advance(delay - ONE_SECOND - 1);
          equal(runs.length, 0);

          await clock.advance(1);
          deepEqual(runs, [runDate]);
        } finally {
          scheduler.shutdownHandler();
        }
      });
    };

    assertLongDelay('longAt', 'at(2026-10-29T10:00:00)', '2026-09-29T10:00:00Z', '2026-10-29T10:00:00.000Z');
    assertLongDelay('longCron', 'cron(0 10 1 1 ? *)', '2026-09-29T00:00:00Z', '2027-01-01T10:00:00.000Z');
    assertLongDelay('longRate', 'rate(30 days)', '2026-09-29T00:00:00Z', '2026-10-29T00:00:00.000Z');

    it('assert :: late timer does not replay the runs it missed', async (t) => {
      const clock = useTestClock(t, '2026-09-29T00:00:00Z');

      const { scheduler, runs } = startScheduler(getCronService('lateTimer', { expression: 'cron(*/5 * * * ? *)' }));

      try {
        // A single tick fires the 00:05 timer only at 01:00, as a paused process would.
        t.mock.timers.tick(ONE_HOUR);

        await clock.advance(5 * ONE_MINUTE);

        deepEqual(runs, ['2026-09-29T01:00:00.000Z', '2026-09-29T01:05:00.000Z']);
      } finally {
        scheduler.shutdownHandler();
      }
    });
  });

  describe('retries', () => {
    const failure = () => {
      return Promise.reject(new Error('Handler failure.'));
    };

    it('assert :: failed run is not retried by default', async (t) => {
      const service = getCronService('retryDefault', {
        expression: 'at(2026-09-29T00:01:00)'
      });

      deepEqual(await collectRuns(t, service, '2026-09-29T00:00:00Z', ONE_HOUR, failure), ['2026-09-29T00:01:00.000Z']);
    });

    it('assert :: failed run is retried up to max retries', async (t) => {
      const warn = t.mock.method(Logger, 'warn');
      const error = t.mock.method(Logger, 'error');

      const service = getCronService('retryLimit', {
        expression: 'at(2026-09-29T00:01:00)',
        maxRetries: 2
      });

      deepEqual(await collectRuns(t, service, '2026-09-29T00:00:00Z', ONE_HOUR, failure), [
        '2026-09-29T00:01:00.000Z',
        '2026-09-29T00:01:01.000Z',
        '2026-09-29T00:01:03.000Z'
      ]);

      equal(getWarnings(warn, 'retryLimit').length, 2);
      equal(getWarnings(error, 'retryLimit').length, 1);
    });

    it('assert :: retry delay is capped at one minute', async (t) => {
      const service = getCronService('retryCap', {
        expression: 'at(2026-09-29T00:01:00)',
        maxRetries: 8
      });

      deepEqual(await collectRuns(t, service, '2026-09-29T00:00:00Z', ONE_HOUR, failure), [
        '2026-09-29T00:01:00.000Z',
        '2026-09-29T00:01:01.000Z',
        '2026-09-29T00:01:03.000Z',
        '2026-09-29T00:01:07.000Z',
        '2026-09-29T00:01:15.000Z',
        '2026-09-29T00:01:31.000Z',
        '2026-09-29T00:02:03.000Z',
        '2026-09-29T00:03:03.000Z',
        '2026-09-29T00:04:03.000Z'
      ]);
    });

    it('assert :: retries stop at the max age', async (t) => {
      const service = getCronService('retryAge', {
        expression: 'at(2026-09-29T00:01:00)',
        maxRetries: 10,
        maxAge: 60
      });

      deepEqual(await collectRuns(t, service, '2026-09-29T00:00:00Z', ONE_HOUR, failure), [
        '2026-09-29T00:01:00.000Z',
        '2026-09-29T00:01:01.000Z',
        '2026-09-29T00:01:03.000Z',
        '2026-09-29T00:01:07.000Z',
        '2026-09-29T00:01:15.000Z',
        '2026-09-29T00:01:31.000Z'
      ]);
    });
  });
});
