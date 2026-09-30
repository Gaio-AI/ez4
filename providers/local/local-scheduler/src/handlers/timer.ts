import type { CronService } from '@ez4/scheduler/library';
import type { ExpressionResult } from '../utils/expression';

import { Logger } from '@ez4/logger';

import { ExpressionType, parseExpression } from '../utils/expression';
import { InMemoryScheduler } from '../service/scheduler';

export const processTimerEvent = (service: CronService) => {
  const { name: resourceName, expression, timezone, startDate, endDate } = service;

  const schedule = parseExpression(expression, {
    timezone,
    startDate,
    endDate
  });

  scheduleTimerEvent(resourceName, schedule, new Date());
};

const scheduleTimerEvent = (resourceName: string, schedule: ExpressionResult, currentDate: Date) => {
  const { type, value } = schedule;

  const nextDate = schedule.getNextDate(currentDate);

  if (!nextDate) {
    return Logger.warn(`Scheduler [${resourceName}] has no upcoming runs for ${type} (${value}).`);
  }

  switch (type) {
    case ExpressionType.Cron:
      Logger.log(`⌚ Scheduler [${resourceName}] will run using cron (${value})`);
      break;

    case ExpressionType.Rate:
      Logger.log(`⌚ Scheduler [${resourceName}] will run in ${value}`);
      break;

    case ExpressionType.At:
      Logger.log(`⌚ Scheduler [${resourceName}] will run at ${value}`);
      return InMemoryScheduler.createTimer(resourceName, type, nextDate);
  }

  InMemoryScheduler.createTimer(resourceName, type, nextDate, () => {
    // A timer that fires late (e.g. the process was paused) doesn't replay the runs it missed.
    scheduleTimerEvent(resourceName, schedule, new Date(Math.max(nextDate.getTime(), Date.now())));
  });
};
