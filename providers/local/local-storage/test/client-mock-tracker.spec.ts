import { describe, it, mock } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { BucketTester } from '../src/service/tester';

describe('local storage client mock tracker', () => {
  it('assert :: tester mock survives restoreAll from another spec', async () => {
    const client = BucketTester.getClientMock('anyBucket');

    await client.exists('a');

    mock.restoreAll();

    await client.exists('b');

    ok(client.exists.mock);
    equal(client.exists.mock.callCount(), 2);
  });
});
