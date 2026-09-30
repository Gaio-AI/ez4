import { describe, it, mock } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { CronTester } from '../src/service/tester';

describe('local scheduler client mock tracker', () => {
  it('assert :: tester mock survives restoreAll from another spec', async () => {
    const client = CronTester.getClientMock('anyScheduler');

    await client.deleteEvent('a');

    mock.restoreAll();

    await client.deleteEvent('b');

    ok(client.deleteEvent.mock);
    equal(client.deleteEvent.mock.callCount(), 2);
  });
});
