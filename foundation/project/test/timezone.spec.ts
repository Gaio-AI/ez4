import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

// `ez4 test` runs this spec, so it sees the time zone the emulation gives every handler.
describe('emulation time zone', () => {
  it('assert :: handlers run in UTC as in Lambda', () => {
    equal(process.env.TZ, 'UTC');
    equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC');
  });

  it('assert :: a time without zone reads as UTC', () => {
    equal(new Date('2026-09-17 17:08:20').toISOString(), '2026-09-17T17:08:20.000Z');
  });
});
