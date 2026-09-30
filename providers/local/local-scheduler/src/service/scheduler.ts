import type { Cron, ScheduleEvent } from '@ez4/scheduler';
import type { MessageTrace } from '@ez4/local-common';
import type { TimeoutHandle } from '../utils/timeout';

import { deepClone, deepMerge } from '@ez4/utils';
import { Logger } from '@ez4/logger';

import { ScheduleConflictError, ScheduleNotFoundError } from '../utils/errors';
import { createTimeout } from '../utils/timeout';

type InMemorySchedulerData<T extends Cron.Event> = InMemoryScheduler.SchedulerParameters & {
  events: Record<string, InMemoryScheduler.ScheduledEvent<T>>;
  timers: Record<string, TimeoutHandle>;
};

type SchedulerRun = {
  timerId: string;
  label: string;
  event: Cron.Event | null;
  trace?: MessageTrace;
  maxRetries: number;
  maxAge?: number;
  isActive: () => boolean;
  onComplete: () => void;
};

const ALL_SCHEDULERS: Record<string, InMemorySchedulerData<any>> = {};

// Without a retry policy, AWS retries a scheduled event 185 times within 24 hours.
const DEFAULT_EVENT_MAX_RETRIES = 185;
const DEFAULT_EVENT_MAX_AGE = 86400;

// AWS doesn't publish the delay between retries, only the retry count and the maximum age follow AWS.
const FIRST_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 60000;

export namespace InMemoryScheduler {
  export type ScheduledEvent<T extends Cron.Event> = ScheduleEvent<T> & MessageTrace;

  export type SchedulerParameters = {
    handler: (event: Cron.Event | null, trace?: MessageTrace) => Promise<void> | void;
    maxRetries?: number;
    maxAge?: number;
  };

  export const createScheduler = (schedulerName: string, parameters: SchedulerParameters) => {
    if (ALL_SCHEDULERS[schedulerName]) {
      throw new Error(`Scheduler ${schedulerName} already exists.`);
    }

    ALL_SCHEDULERS[schedulerName] = {
      ...parameters,
      events: {},
      timers: {}
    };
  };

  export const deleteScheduler = (schedulerName: string) => {
    const instance = getScheduler(schedulerName);

    for (const timerId in instance.timers) {
      instance.timers[timerId].cancel();
    }

    delete ALL_SCHEDULERS[schedulerName];
  };

  export const getScheduler = (schedulerName: string) => {
    if (!ALL_SCHEDULERS[schedulerName]) {
      throw new Error(`Scheduler ${schedulerName} not found.`);
    }

    return ALL_SCHEDULERS[schedulerName];
  };

  export const createTimer = (schedulerName: string, identifier: string, date: Date, callback?: () => void) => {
    const instance = getScheduler(schedulerName);

    instance.timers[identifier]?.cancel();

    instance.timers[identifier] = createTimeout(() => {
      const timerId = `${identifier}:${date.toISOString()}`;

      callback?.();

      runHandler(instance, {
        timerId,
        label: `Scheduler [${schedulerName}]`,
        event: null,
        maxRetries: instance.maxRetries ?? 0,
        maxAge: instance.maxAge,
        isActive: () => {
          return ALL_SCHEDULERS[schedulerName] === instance;
        },
        onComplete: () => {
          delete instance.timers[timerId];
        }
      });
    }, date.getTime() - Date.now());
  };

  export const getEvent = (schedulerName: string, identifier: string) => {
    const event = getScheduler(schedulerName).events[identifier];

    if (!event) {
      return undefined;
    }

    return deepClone(event, {
      include: {
        date: true,
        maxRetries: true,
        maxAge: true,
        event: true
      }
    });
  };

  export const setEvent = <T extends Cron.Event>(schedulerName: string, identifier: string, input: ScheduledEvent<T>) => {
    scheduleEvent(schedulerName, identifier, input);
  };

  export const createEvent = <T extends Cron.Event>(schedulerName: string, identifier: string, input: ScheduledEvent<T>) => {
    if (getScheduler(schedulerName).events[identifier]) {
      throw new ScheduleConflictError(identifier);
    }

    scheduleEvent(schedulerName, identifier, input);
  };

  export const updateEvent = <T extends Cron.Event>(schedulerName: string, identifier: string, input: Partial<ScheduleEvent<T>>) => {
    const previousEvent = getScheduler(schedulerName).events[identifier];

    if (!previousEvent) {
      throw new ScheduleNotFoundError(identifier);
    }

    scheduleEvent(schedulerName, identifier, deepMerge(previousEvent, input));
  };

  export const deleteEvent = (schedulerName: string, identifier: string) => {
    const instance = getScheduler(schedulerName);
    const event = instance.events[identifier];

    if (!event) {
      return undefined;
    }

    instance.timers[identifier]?.cancel();

    delete instance.timers[identifier];
    delete instance.events[identifier];

    return event;
  };
}

const scheduleEvent = <T extends Cron.Event>(schedulerName: string, identifier: string, input: InMemoryScheduler.ScheduledEvent<T>) => {
  const instance = InMemoryScheduler.getScheduler(schedulerName);
  const interval = input.date.getTime() - Date.now();

  if (interval < 0) {
    throw new Error(`Event for scheduler ${schedulerName} is too old.`);
  }

  const isCurrentEvent = () => {
    return ALL_SCHEDULERS[schedulerName] === instance && instance.events[identifier] === input;
  };

  instance.timers[identifier]?.cancel();

  instance.timers[identifier] = createTimeout(() => {
    runHandler(instance, {
      timerId: identifier,
      label: `Scheduler [${schedulerName}] event ${identifier}`,
      event: input.event,
      trace: {
        traceId: input.traceId,
        scope: input.scope
      },
      maxRetries: input.maxRetries ?? instance.maxRetries ?? DEFAULT_EVENT_MAX_RETRIES,
      maxAge: input.maxAge ?? instance.maxAge ?? DEFAULT_EVENT_MAX_AGE,
      isActive: isCurrentEvent,
      onComplete: () => {
        // As with ActionAfterCompletion DELETE on AWS, the event is gone once it's done.
        if (isCurrentEvent()) {
          delete instance.timers[identifier];
          delete instance.events[identifier];
        }
      }
    });
  }, interval);

  instance.events[identifier] = input;
};

const runHandler = async (instance: InMemorySchedulerData<Cron.Event>, run: SchedulerRun, attempt = 0, firstTime = Date.now()) => {
  try {
    await instance.handler(run.event, run.trace);
    //
  } catch {
    if (!run.isActive()) {
      return;
    }

    const delay = Math.min(FIRST_RETRY_DELAY * 2 ** attempt, MAX_RETRY_DELAY);
    const retryAge = Date.now() + delay - firstTime;

    if (attempt < run.maxRetries && (run.maxAge === undefined || retryAge <= run.maxAge * 1000)) {
      Logger.warn(`${run.label} failed, retry ${attempt + 1} of ${run.maxRetries} in ${delay / 1000}s.`);

      instance.timers[run.timerId] = createTimeout(() => runHandler(instance, run, attempt + 1, firstTime), delay);
      return;
    }

    Logger.error(`${run.label} failed after ${attempt + 1} attempt(s) and was dropped.`);
  }

  run.onComplete();
};
