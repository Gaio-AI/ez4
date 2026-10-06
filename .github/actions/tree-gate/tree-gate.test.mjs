import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONTEXT, backMergeVerdict, candidates, carriesTree, isBackMerge, pullFor, releaseOnly, releaseSource } from './tree-gate.mjs';

const BOT = '41898282+github-actions[bot]@users.noreply.github.com';
const log = (...commits) => commits.map(([email, subject]) => `${email}\t${subject}`).join('\n');

const pull = (head, base, sha = 'merged') => ({
  base: { ref: base },
  head: { ref: head, sha: `${head}-head` },
  merge_commit_sha: sha
});

test('a tree is tested only when the latest Tested tree status is a success for that tree', () => {
  const passed = { context: CONTEXT, description: 'tree-a', state: 'success' };

  assert.equal(carriesTree([passed], 'tree-a'), true);
  assert.equal(carriesTree([passed], 'tree-b'), false);
  assert.equal(carriesTree([{ ...passed, state: 'failure' }, passed], 'tree-a'), false);
  assert.equal(carriesTree([{ context: 'CI', description: 'tree-a', state: 'success' }], 'tree-a'), false);
  assert.equal(carriesTree([], 'tree-a'), false);
});

test('a squash on develop is covered by its pull request head', () => {
  assert.deepEqual(candidates(['previous'], pull('feature/x', 'develop')), ['feature/x-head']);
});

test('a merge commit on main is covered by the develop head it merged', () => {
  assert.deepEqual(candidates(['main-before', 'develop-head'], undefined), ['develop-head']);
});

test('a push with no pull request and a single parent has nothing covering it', () => {
  assert.deepEqual(candidates(['previous'], undefined), []);
});

test('only the pull request whose merge produced the commit counts', () => {
  const pulls = [pull('feature/a', 'develop', 'other'), pull('develop', 'main', 'wanted')];

  assert.equal(pullFor(pulls, 'wanted')?.head.ref, 'develop');
  assert.equal(pullFor(pulls, 'missing'), undefined);
});

test('main releases only what came from develop or a hotfix branch', () => {
  assert.equal(releaseSource(pull('develop', 'main')), 'develop');
  assert.equal(releaseSource(pull('hotfix/login-loop', 'main')), 'hotfix');
  assert.equal(releaseSource(pull('feature/x', 'main')), 'other');
  assert.equal(releaseSource(pull('hotfix/x', 'develop')), 'other');
  assert.equal(releaseSource(undefined), 'other');
});

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

test('only a back-merge branch into develop is a back-merge', () => {
  assert.equal(isBackMerge(pull('back-merge/0123456789ab', 'develop')), true);
  assert.equal(isBackMerge(pull('back-merge/0123456789ab', 'main')), false);
  assert.equal(isBackMerge(pull('feature/back-merge', 'develop')), false);
  assert.equal(isBackMerge(undefined), false);
});

test('a back-merge of only the release commit is tested exactly when develop was', () => {
  const release = log([BOT, 'release v1.4.0']);
  assert.deepEqual(backMergeVerdict({ log: release, firstParentTested: true }), { tested: true, deploy: '' });
  assert.deepEqual(backMergeVerdict({ log: release, firstParentTested: false }), { tested: false, deploy: '' });
});

test('a back-merge bringing a hotfix runs the suite and deploys everything', () => {
  const hotfix = log([BOT, 'release v1.4.1'], ['dev@gaio.social', 'fix: keep the session on refresh (#940)']);
  assert.deepEqual(backMergeVerdict({ log: hotfix, firstParentTested: true }), { tested: false, deploy: 'all' });
});
