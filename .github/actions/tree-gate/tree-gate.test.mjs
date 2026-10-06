import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONTEXT, candidates, carriesTree, pullFor, releaseSource } from './tree-gate.mjs';

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
