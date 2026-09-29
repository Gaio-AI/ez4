import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { CronService } from '@ez4/scheduler/library';
import type { Client } from '@ez4/scheduler';
import type { TestContext } from 'node:test';

import { deepEqual, equal, notEqual, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerLocalService } from '../src/provider/local';
import { InMemoryScheduler } from '../src/service/scheduler';
import { useTestClock } from './clock';

type TestEvent = {
  foo: string;
};

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

const NOW = '2026-09-29T00:00:00.000Z';

const options = {
  prefix: 'ez4',
  projectName: 'events',
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

const getDynamicService = (name: string, properties?: Partial<CronService>) => {
  return {
    type: '@ez4/scheduler',
    name,
    services: {},
    variables: {},
    expression: 'dynamic',
    schema: {
      type: 'object',
      properties: {
        foo: {
          type: 'string'
        }
      }
    },
    target: {
      handler: {
        name: 'failProbe',
        file: 'test/fixtures/failure-probe.ts',
        position: [1, 1]
      }
    },
    ...properties
  } as unknown as CronService;
};

const getDate = (offset: number) => {
  return new Date(Date.parse(NOW) + offset);
};

const getRunDates = (offsets: number[]) => {
  return offsets.map((offset) => getDate(offset).toISOString());
};

const getRetryDates = (seconds: number[]) => {
  return getRunDates(seconds.map((second) => ONE_MINUTE + second * ONE_SECOND));
};

const success = () => {};

const failure = () => {
  return Promise.reject(new Error('Handler failure.'));
};

// Lets promise and I/O callbacks run while the timers are mocked.
const waitFor = async (condition: () => boolean, turns = 1000) => {
  for (let turn = 0; turn < turns && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const settle = () => {
  return waitFor(() => false, 10);
};

const startScheduler = (t: TestContext, service: CronService, handler?: () => Promise<void> | void) => {
  const clock = useTestClock(t, NOW);

  const runs: string[] = [];

  const scheduler = registerLocalService(service, options, context);

  scheduler.bootstrapHandler();

  if (handler) {
    InMemoryScheduler.getScheduler(service.name).handler = () => {
      runs.push(new Date().toISOString());
      return handler();
    };
  }

  const client = scheduler.exportHandler() as Client<TestEvent>;

  return { scheduler, client, clock, runs };
};

describe('local scheduler events', () => {
  it('assert :: create event rejects an existing identifier', async (t) => {
    const { scheduler, client, clock, runs } = startScheduler(t, getDynamicService('eventConflict'), success);

    try {
      await client.createEvent('event-1', {
        date: getDate(ONE_MINUTE),
        event: {
          foo: 'first'
        }
      });

      await rejects(
        client.createEvent('event-1', {
          date: getDate(2 * ONE_MINUTE),
          event: {
            foo: 'second'
          }
        }),
        {
          name: 'ConflictException',
          message: 'Schedule event-1 already exists.'
        }
      );

      await clock.advance(ONE_HOUR);

      await settle();

      deepEqual(runs, getRunDates([ONE_MINUTE]));
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: event is deleted once it runs', async (t) => {
    const { scheduler, client, clock, runs } = startScheduler(t, getDynamicService('eventCompleted'), success);

    try {
      await client.createEvent('event-1', {
        date: getDate(ONE_MINUTE),
        event: {
          foo: 'bar'
        }
      });

      await clock.advance(ONE_MINUTE);

      await settle();

      deepEqual(runs, getRunDates([ONE_MINUTE]));

      equal(await client.getEvent('event-1'), undefined);
      equal(await client.deleteEvent('event-1'), false);
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: event is deleted after its last failed retry', async (t) => {
    const { scheduler, client, clock, runs } = startScheduler(t, getDynamicService('eventDropped'), failure);

    try {
      await client.createEvent('event-1', {
        date: getDate(ONE_MINUTE),
        maxRetries: 1,
        event: {
          foo: 'bar'
        }
      });

      await clock.advance(ONE_MINUTE);

      await settle();

      notEqual(await client.getEvent('event-1'), undefined);

      await clock.advance(ONE_SECOND);

      await settle();

      deepEqual(runs, getRetryDates([0, 1]));

      equal(await client.getEvent('event-1'), undefined);
      equal(await client.deleteEvent('event-1'), false);
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: update event rejects a missing identifier', async (t) => {
    const { scheduler, client } = startScheduler(t, getDynamicService('eventMissing'), success);

    try {
      await rejects(client.updateEvent('event-1', { date: getDate(ONE_MINUTE) }), {
        name: 'ResourceNotFoundException'
      });
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: set event replaces the pending event', async (t) => {
    const { scheduler, client, clock, runs } = startScheduler(t, getDynamicService('eventReplaced'), success);

    try {
      await client.setEvent('event-1', {
        date: getDate(ONE_MINUTE),
        event: {
          foo: 'first'
        }
      });

      await client.setEvent('event-1', {
        date: getDate(2 * ONE_MINUTE),
        event: {
          foo: 'second'
        }
      });

      await clock.advance(ONE_HOUR);

      await settle();

      deepEqual(runs, getRunDates([2 * ONE_MINUTE]));
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: event is retried 185 times by default', async (t) => {
    const { scheduler, client, clock, runs } = startScheduler(t, getDynamicService('eventDefaultRetries'), failure);

    try {
      await client.createEvent('event-1', {
        date: getDate(ONE_MINUTE),
        event: {
          foo: 'bar'
        }
      });

      await clock.advance(4 * ONE_HOUR);

      await settle();

      equal(runs.length, 186);

      deepEqual(runs.slice(0, 9), getRetryDates([0, 1, 3, 7, 15, 31, 63, 123, 183]));

      equal(await client.getEvent('event-1'), undefined);
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: event retries follow the event policy', async (t) => {
    const { scheduler, client, clock, runs } = startScheduler(t, getDynamicService('eventPolicy', { maxRetries: 5 }), failure);

    try {
      await client.createEvent('event-1', {
        date: getDate(ONE_MINUTE),
        maxRetries: 2,
        event: {
          foo: 'bar'
        }
      });

      await clock.advance(ONE_HOUR);

      await settle();

      deepEqual(runs, getRetryDates([0, 1, 3]));
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: event retries fall back to the service policy', async (t) => {
    const { scheduler, client, clock, runs } = startScheduler(t, getDynamicService('servicePolicy', { maxRetries: 1 }), failure);

    try {
      await client.createEvent('event-1', {
        date: getDate(ONE_MINUTE),
        event: {
          foo: 'bar'
        }
      });

      await clock.advance(ONE_HOUR);

      await settle();

      deepEqual(runs, getRetryDates([0, 1]));
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: event retries stop at the max age', async (t) => {
    const { scheduler, client, clock, runs } = startScheduler(t, getDynamicService('eventMaxAge'), failure);

    try {
      await client.createEvent('event-1', {
        date: getDate(ONE_MINUTE),
        maxAge: 60,
        event: {
          foo: 'bar'
        }
      });

      await clock.advance(ONE_HOUR);

      await settle();

      deepEqual(runs, getRetryDates([0, 1, 3, 7, 15, 31]));

      equal(await client.getEvent('event-1'), undefined);
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: event runs 30 days ahead', async (t) => {
    const { scheduler, client, clock, runs } = startScheduler(t, getDynamicService('eventLongDelay'), success);

    try {
      await client.createEvent('event-1', {
        date: getDate(30 * ONE_DAY),
        event: {
          foo: 'bar'
        }
      });

      await clock.advance(ONE_SECOND);
      equal(runs.length, 0);

      await clock.advance(30 * ONE_DAY - ONE_SECOND - 1);
      equal(runs.length, 0);

      await clock.advance(1);
      deepEqual(runs, getRunDates([30 * ONE_DAY]));
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: event handler failure is retried', async (t) => {
    const { scheduler, client, clock } = startScheduler(t, getDynamicService('eventHandlerFailure', { maxRetries: 1 }));

    let failures = 0;

    globalThis.observeFailure = () => failures++;

    try {
      await client.createEvent('event-1', {
        date: getDate(ONE_SECOND),
        event: {
          foo: 'bar'
        }
      });

      await clock.advance(ONE_SECOND);

      await waitFor(() => failures === 1);
      await settle();

      await clock.advance(ONE_SECOND);

      await waitFor(() => failures === 2);
      await settle();

      equal(failures, 2);

      equal(await client.getEvent('event-1'), undefined);
    } finally {
      globalThis.observeFailure = undefined;
      scheduler.shutdownHandler();
    }
  });

  it('assert :: trigger request answers with the handler failure', async () => {
    const scheduler = registerLocalService(getDynamicService('triggerFailure'), options, context);

    scheduler.bootstrapHandler();

    let failures = 0;

    globalThis.observeFailure = () => failures++;

    try {
      await rejects(
        scheduler.requestHandler({
          method: 'POST',
          path: '/',
          query: {},
          headers: {},
          body: Buffer.from(JSON.stringify({ foo: 'bar' }))
        }),
        {
          message: 'Probe failure.'
        }
      );

      await settle();

      equal(failures, 1);
    } finally {
      globalThis.observeFailure = undefined;
      scheduler.shutdownHandler();
    }
  });
});
