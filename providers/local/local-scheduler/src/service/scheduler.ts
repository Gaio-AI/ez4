import type { Cron, ScheduleEvent } from '@ez4/scheduler';
import type { MessageTrace } from '@ez4/local-common';

import { deepClone, deepMerge } from '@ez4/utils';

type InMemorySchedulerData<T extends Cron.Event> = InMemoryScheduler.SchedulerParameters & {
  events: Record<string, InMemoryScheduler.ScheduledEvent<T>>;
  timers: Record<string, NodeJS.Timeout>;
};

const ALL_SCHEDULERS: Record<string, InMemorySchedulerData<any>> = {};

export namespace InMemoryScheduler {
  export type ScheduledEvent<T extends Cron.Event> = ScheduleEvent<T> & MessageTrace;

  export type SchedulerParameters = {
    handler: (event: Cron.Event | null, trace?: MessageTrace) => Promise<void> | void;
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
      clearTimeout(instance.timers[timerId]);
    }

    delete ALL_SCHEDULERS[schedulerName];
  };

  export const getScheduler = (schedulerName: string) => {
    if (!ALL_SCHEDULERS[schedulerName]) {
      throw new Error(`Scheduler ${schedulerName} not found.`);
    }

    return ALL_SCHEDULERS[schedulerName];
  };

  export const createTimer = (schedulerName: string, identifier: string, timeout: number, callback?: () => void) => {
    const instance = getScheduler(schedulerName);

    instance.timers[identifier] = setTimeout(async () => {
      callback?.();
      await instance.handler(null);
    }, timeout);
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
    const instance = getScheduler(schedulerName);
    const interval = input.date.getTime() - Date.now();

    if (interval < 0) {
      throw new Error(`Event for scheduler ${schedulerName} is too old.`);
    }

    clearTimeout(instance.timers[identifier]);

    instance.timers[identifier] = setTimeout(() => instance.handler(input.event, { traceId: input.traceId, scope: input.scope }), interval);
    instance.events[identifier] = input;
  };

  export const createEvent = <T extends Cron.Event>(schedulerName: string, identifier: string, input: ScheduledEvent<T>) => {
    const instance = getScheduler(schedulerName);
    const interval = input.date.getTime() - Date.now();

    if (interval < 0) {
      throw new Error(`Event for scheduler ${schedulerName} is too old.`);
    }

    instance.timers[identifier] = setTimeout(() => instance.handler(input.event, { traceId: input.traceId, scope: input.scope }), interval);
    instance.events[identifier] = input;
  };

  export const updateEvent = <T extends Cron.Event>(schedulerName: string, identifier: string, input: Partial<ScheduleEvent<T>>) => {
    const previousEvent = deleteEvent(schedulerName, identifier);

    if (!previousEvent) {
      throw new Error(`Event ${identifier} not found on scheduler ${schedulerName}.`);
    }

    const currentEvent = deepMerge(previousEvent, input);

    createEvent(schedulerName, identifier, currentEvent);
  };

  export const deleteEvent = (schedulerName: string, identifier: string) => {
    const instance = getScheduler(schedulerName);

    const event = instance.events[identifier];
    const timer = instance.timers[identifier];

    if (!event || !timer) {
      return undefined;
    }

    clearTimeout(timer);

    delete instance.events[identifier];

    return event;
  };
}
