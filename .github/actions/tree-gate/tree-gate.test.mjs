import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONTEXT, RELEASE_BRANCH, candidates, carriesTree, pullFor, releaseSource } from './tree-gate.mjs';

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

test('a squash on develop is covered by itself and its pull request head', () => {
  assert.deepEqual(candidates('squash', ['previous'], pull('feature/x', 'develop')), ['squash', 'feature/x-head']);
});

test('the merge of the release PR into main is covered by the release branch head it merged', () => {
  assert.deepEqual(candidates('merge', ['main-before', 'release-head'], pull(RELEASE_BRANCH, 'main')), [
    'merge',
    `${RELEASE_BRANCH}-head`,
    'release-head'
  ]);
});

test('a commit with no pull request and a single parent is covered only by its own status', () => {
  assert.deepEqual(candidates('release-head', ['develop-merged-with-main'], undefined), ['release-head']);
});

test('only the pull request whose merge produced the commit counts', () => {
  const pulls = [pull('feature/a', 'develop', 'other'), pull(RELEASE_BRANCH, 'main', 'wanted')];

  assert.equal(pullFor(pulls, 'wanted')?.head.ref, RELEASE_BRANCH);
  assert.equal(pullFor(pulls, 'missing'), undefined);
});

test('main releases only what came from the release branch or a hotfix branch', () => {
  assert.equal(releaseSource(pull(RELEASE_BRANCH, 'main')), 'release');
  assert.equal(releaseSource(pull('hotfix/login-loop', 'main')), 'hotfix');
  assert.equal(releaseSource(pull('develop', 'main')), 'other');
  assert.equal(releaseSource(pull('feature/x', 'main')), 'other');
  assert.equal(releaseSource(pull('hotfix/x', 'develop')), 'other');
  assert.equal(releaseSource(undefined), 'other');
});
