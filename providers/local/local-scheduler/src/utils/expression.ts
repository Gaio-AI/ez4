import { CronDate, CronExpressionParser } from 'cron-parser';

import { TimeUnits } from './time';

export const enum ExpressionType {
  Cron = 'cron',
  Rate = 'rate',
  At = 'at'
}

export type ExpressionOptions = {
  timezone?: string;
  startDate?: string;
  endDate?: string;
};

export type ExpressionResult = {
  type: ExpressionType;
  value: string;
  getNextDate: (currentDate: Date) => Date | undefined;
};

type CronSchedule = {
  value: string;
  timezone: string;
  years: number[];
  weekday?: WeekdayDay;
  startTime?: number;
  endTime?: number;
};

type WeekdayDay = number | 'L';

const DEFAULT_TIMEZONE = 'UTC';

const MIN_YEAR = 1970;
const MAX_YEAR = 2199;

const MAX_CRON_STEPS = 1000;

const DAY_OF_WEEK_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const parseRateExpression = (input: string, options: ExpressionOptions = {}): ExpressionResult | undefined => {
  const match = input.match(/^rate\(\s*(\d+)\s+(minute|minutes|hour|hours|day|days)\s*\)$/i);

  if (match?.length !== 3) {
    return undefined;
  }

  const unit = match[2] as keyof typeof TimeUnits;
  const time = parseInt(match[1], 10);
  const interval = time * TimeUnits[unit];

  const startTime = getOptionalTime(options.startDate);
  const endTime = getOptionalTime(options.endDate);

  return {
    type: ExpressionType.Rate,
    value: `${time} ${unit}`,
    getNextDate: (currentDate) => {
      const nextTime = getNextRateTime(interval, currentDate.getTime(), startTime);

      return getBoundedDate(nextTime, endTime);
    }
  };
};

export const parseCronExpression = (input: string, options: ExpressionOptions = {}): ExpressionResult | undefined => {
  const match = input.match(/^cron\((\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\)$/i);

  if (!match) {
    return undefined;
  }

  const [, minutes, hours, dayOfMonth, month, dayOfWeek, year] = match;

  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const weekday = parseWeekdayDay(dayOfMonth);
  const years = parseYears(year);

  if (!years) {
    return undefined;
  }

  // The nearest weekday is resolved on each candidate, so cron-parser gets any day of the month.
  const value = [minutes, hours, weekday ? '*' : dayOfMonth, month, getDayOfWeekField(dayOfWeek)].join(' ');

  try {
    CronExpressionParser.parse(value, { tz: timezone });
  } catch {
    return undefined;
  }

  const schedule: CronSchedule = {
    value,
    timezone,
    weekday,
    years,
    startTime: getOptionalTime(options.startDate),
    endTime: getOptionalTime(options.endDate)
  };

  return {
    type: ExpressionType.Cron,
    value: match.slice(1).join(' '),
    getNextDate: (currentDate) => {
      return getNextCronDate(schedule, currentDate);
    }
  };
};

export const parseAtExpression = (input: string, options: ExpressionOptions = {}): ExpressionResult | undefined => {
  const match = input.match(/^at\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\)$/i);

  if (match?.length !== 2) {
    return undefined;
  }

  const value = match[1];
  const date = getZonedDate(value, options.timezone ?? DEFAULT_TIMEZONE);

  if (!date) {
    return undefined;
  }

  return {
    type: ExpressionType.At,
    value,
    // One-time schedules run once on their date, AWS ignores the start and end dates for them.
    getNextDate: () => date
  };
};

export const parseExpression = (input: string, options?: ExpressionOptions) => {
  const expression = parseRateExpression(input, options) ?? parseCronExpression(input, options) ?? parseAtExpression(input, options);

  if (!expression) {
    throw new Error(`Expression '${input}' isn\'t supported.`);
  }

  return expression;
};

const getNextRateTime = (interval: number, currentTime: number, startTime?: number) => {
  if (startTime === undefined) {
    return currentTime + interval;
  }

  // The start date is the first run, the next ones follow at every interval after it.
  if (currentTime < startTime) {
    return startTime;
  }

  return startTime + (Math.floor((currentTime - startTime) / interval) + 1) * interval;
};

const getNextCronDate = (schedule: CronSchedule, currentDate: Date) => {
  const { value, timezone, weekday, years, startTime, endTime } = schedule;

  // Searching from right before the start date keeps a run that falls on it.
  let fromTime = startTime !== undefined ? Math.max(currentDate.getTime(), startTime - 1) : currentDate.getTime();

  for (let step = 0; step < MAX_CRON_STEPS; step++) {
    const candidate = getNextCronCandidate(value, timezone, fromTime);

    if (!candidate) {
      return undefined;
    }

    const year = candidate.getFullYear();
    const nextYear = years.find((allowedYear) => allowedYear >= year);

    if (nextYear === undefined) {
      return undefined;
    }

    if (nextYear > year) {
      fromTime = getZonedTime(nextYear, 1, 1, timezone) - 1;
      continue;
    }

    if (weekday) {
      const month = candidate.getMonth() + 1;
      const day = candidate.getDate();

      const weekdayDay = getNearestWeekday(year, month, weekday);

      if (weekdayDay === undefined || day > weekdayDay) {
        fromTime = (month < 12 ? getZonedTime(year, month + 1, 1, timezone) : getZonedTime(year + 1, 1, 1, timezone)) - 1;
        continue;
      }

      if (day < weekdayDay) {
        fromTime = getZonedTime(year, month, weekdayDay, timezone) - 1;
        continue;
      }
    }

    return getBoundedDate(candidate.getTime(), endTime);
  }

  return undefined;
};

const getNextCronCandidate = (value: string, timezone: string, fromTime: number) => {
  try {
    return CronExpressionParser.parse(value, { tz: timezone, currentDate: fromTime }).next();
  } catch {
    return undefined;
  }
};

// AWS runs nW on the weekday nearest to the day n and LW on the last weekday, both within the same month.
const getNearestWeekday = (year: number, month: number, weekday: WeekdayDay) => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = weekday === 'L' ? lastDay : weekday;

  if (day > lastDay) {
    return undefined;
  }

  switch (new Date(Date.UTC(year, month - 1, day)).getUTCDay()) {
    case 0:
      return day < lastDay ? day + 1 : day - 2;

    case 6:
      return day > 1 ? day - 1 : day + 2;

    default:
      return day;
  }
};

const parseWeekdayDay = (dayOfMonth: string): WeekdayDay | undefined => {
  if (dayOfMonth === 'LW') {
    return 'L';
  }

  const match = dayOfMonth.match(/^(\d{1,2})W$/);
  const day = match ? parseInt(match[1], 10) : 0;

  return day >= 1 && day <= 31 ? day : undefined;
};

const parseYears = (field: string) => {
  const years = new Set<number>();

  for (const item of field.split(',')) {
    const match = item.match(/^(?:(\*)|(\d{4})(?:-(\d{4}))?)(?:\/(\d+))?$/);

    if (!match) {
      return undefined;
    }

    const [, wildcard, first, last, step] = match;

    const start = wildcard ? MIN_YEAR : parseInt(first, 10);
    const end = wildcard || (step && !last) ? MAX_YEAR : parseInt(last ?? first, 10);
    const increment = step ? parseInt(step, 10) : 1;

    if (start < MIN_YEAR || end > MAX_YEAR || start > end || increment < 1) {
      return undefined;
    }

    for (let year = start; year <= end; year += increment) {
      years.add(year);
    }
  }

  return [...years].sort((a, b) => a - b);
};

// AWS numbers the days of the week from 1 (SUN) to 7 (SAT) and cron-parser from 0 (SUN) to 6 (SAT).
const getDayOfWeekField = (field: string) => {
  return field.split(',').map(getDayOfWeekItem).join(',');
};

const getDayOfWeekItem = (item: string) => {
  // A lone L is the last day of the week.
  if (item === 'L') {
    return '6';
  }

  const step = item.match(/^(?:\*|(\w+)(?:-(\w+))?)\/(\d+)$/);

  // cron-parser counts a step up to 7 (SUN again), so steps turn into the list of days they cover.
  if (step) {
    return getDayOfWeekStep(step[1], step[2], parseInt(step[3], 10)) ?? item;
  }

  // Single days, both ends of a range, and the day before # and L.
  return item.replace(/(?<![#\d])\d+/g, (day) => `${parseInt(day, 10) - 1}`);
};

const getDayOfWeekStep = (first: string | undefined, last: string | undefined, increment: number) => {
  const start = first ? getDayOfWeekNumber(first) : 1;
  const end = last ? getDayOfWeekNumber(last) : 7;

  if (!(start >= 1 && start <= end && end <= 7 && increment >= 1)) {
    return undefined;
  }

  const days: number[] = [];

  for (let day = start; day <= end; day += increment) {
    days.push(day - 1);
  }

  return days.join(',');
};

const getDayOfWeekNumber = (day: string) => {
  const index = DAY_OF_WEEK_NAMES.indexOf(day.toUpperCase());

  return index >= 0 ? index + 1 : Number(day);
};

const getZonedTime = (year: number, month: number, day: number, timezone: string) => {
  const date = `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}T00:00:00`;

  return new CronDate(date, timezone).getTime();
};

const getZonedDate = (date: string, timezone: string) => {
  try {
    return new CronDate(date, timezone).toDate();
  } catch {
    return undefined;
  }
};

const getOptionalTime = (date: string | undefined) => {
  if (!date) {
    return undefined;
  }

  const time = new Date(date).getTime();

  if (Number.isNaN(time)) {
    throw new Error(`Date '${date}' isn't valid.`);
  }

  return time;
};

const getBoundedDate = (time: number, endTime: number | undefined) => {
  return endTime === undefined || time <= endTime ? new Date(time) : undefined;
};
