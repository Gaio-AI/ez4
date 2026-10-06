import assert from 'node:assert/strict';
import { test } from 'node:test';

import { branchFor } from './back-merge.mjs';

test('the branch name is stable for a commit, so a re-run reuses it', () => {
  assert.equal(branchFor('0123456789abcdef0123'), 'back-merge/0123456789ab');
});
