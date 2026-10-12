import { describe, it } from 'node:test';
import { equal } from 'node:assert/strict';

import { hasUnexpiredLogs } from '@ez4/aws-logs';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

describe('group :: unexpired logs', () => {
  const now = Date.now();

  it('has nothing to keep when no stream ever received an event', () => {
    equal(hasUnexpiredLogs(7, undefined, now), false);
  });

  it('keeps logs that have not reached the retention', () => {
    equal(hasUnexpiredLogs(7, now - DAY_IN_MS, now), true);
  });

  it('has nothing to keep once the retention has passed', () => {
    equal(hasUnexpiredLogs(7, now - 8 * DAY_IN_MS, now), false);
  });

  it('keeps logs without a retention, which never expire', () => {
    equal(hasUnexpiredLogs(undefined, now - 365 * DAY_IN_MS, now), true);
  });
});
