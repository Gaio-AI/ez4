import assert from 'node:assert/strict';
import { test } from 'node:test';

import { conflictMessage, hotfixProblems, releasesIn, versionBumped } from './changeset-release.mjs';

test('a changeset releases the packages its front matter names', () => {
  assert.equal(releasesIn("---\n'@gaio/console': minor\n'@gaio/site': patch\n---\n\nAdd search.\n"), 2);
  assert.equal(releasesIn('---\n"computron": patch\n---\n'), 1);
});

test('an empty changeset releases nothing', () => {
  assert.equal(releasesIn('---\n---\n\nCI only.\n'), 0);
});

test('a markdown file without front matter is not a changeset', () => {
  assert.equal(releasesIn('# Changesets\n\nHello --- world\n'), 0);
  assert.equal(releasesIn('intro\n---\n"computron": patch\n---\n'), 0);
});

test('a changed top-level version is a bump; a dependency change is not', () => {
  assert.equal(versionBumped('-  "version": "0.6.0",\n+  "version": "0.6.1",'), true);
  assert.equal(versionBumped('-    "@ez4/utils": "^1.0.0",\n+    "@ez4/utils": "^1.1.0",'), false);
  assert.equal(versionBumped(''), false);
});

test('a versioned hotfix passes', () => {
  assert.deepEqual(hotfixProblems({ pending: [], bumped: true }), []);
});

test('a hotfix that kept its changeset or bumped nothing fails with the step to take', () => {
  const [unconsumed] = hotfixProblems({ pending: ['quick-fix.md'], bumped: true });
  assert.match(unconsumed, /changeset version.*quick-fix\.md/);

  const [unversioned] = hotfixProblems({ pending: [], bumped: false });
  assert.match(unversioned, /add a changeset/);
});

test('a conflict names the files and the way out', () => {
  const message = conflictMessage(['package.json', 'src/a.ts']);
  assert.match(message, /package\.json, src\/a\.ts/);
  assert.match(message, /sync\/\* branch from develop, merge main into it/);
  assert.match(message, /merge commit/);
});
