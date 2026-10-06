import assert from 'node:assert/strict';
import { test } from 'node:test';

import { branchFor, releaseOnly } from './back-merge.mjs';

const BOT = '41898282+github-actions[bot]@users.noreply.github.com';
const log = (...commits) => commits.map(([email, subject]) => `${email}\t${subject}`).join('\n');

test("the bot's release commit of every repo brings no code", () => {
  assert.equal(releaseOnly(log([BOT, 'release: console@0.6.0, site@0.2.1'])), true);
  assert.equal(releaseOnly(log([BOT, 'release v1.4.0'])), true);
  assert.equal(releaseOnly(log([BOT, 'chore: version 1.1.1'])), true);
});

test('a hotfix next to the release commit brings code', () => {
  assert.equal(releaseOnly(log([BOT, 'release: console@0.5.1'], ['dev@gaio.social', 'fix: keep the session on refresh (#940)'])), false);
});

test('a person committing a "release:" subject is code, not a release', () => {
  assert.equal(releaseOnly(log(['dev@gaio.social', 'release: console@0.6.0'])), false);
});

test('main bringing no commit brings nothing', () => {
  assert.equal(releaseOnly(''), true);
});

test('the branch name is stable for a commit, so a re-run reuses it', () => {
  assert.equal(branchFor('0123456789abcdef0123'), 'back-merge/0123456789ab');
});
