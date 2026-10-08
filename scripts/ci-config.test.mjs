import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = JSON.parse(readFileSync('.github/gaio-ci.json', 'utf8'));
const read = (path) => readFileSync(path, 'utf8');

test('the develop flow is gone and the callers use gaio-actions', () => {
  for (const path of ['.github/actions/tree-gate', '.github/actions/changeset-release']) assert.equal(existsSync(path), false, path);
  for (const file of ['.github/workflows/pr.yml', '.github/workflows/release.yml']) {
    assert.match(read(file), /Gaio-AI\/gaio-actions\/\.github\/workflows\/(pr|release)\.yml@v1/);
    assert.doesNotMatch(read(file), /develop|changeset-release|hotfix\/|sync\//);
  }
  assert.equal(JSON.parse(read('.changeset/config.json')).baseBranch, 'main');
});

test('ez4 publishes once as v<version>, with no demo stage', () => {
  assert.deepEqual(config.apps, [{ dir: 'foundation/utils', name: 'ez4', tag: 'v{version}', demo: null, prd: 'npm run release' }]);
  assert.ok(JSON.parse(read('package.json')).scripts.release, 'root release script exists');
});

test('the changeset job enforces the Breaking: rule, since a changeset-only PR skips every other leg', () => {
  assert.match(config.changeset, /npm run changeset:check/);
  assert.equal((config.checks ?? []).some((check) => check.name === 'changeset-check'), false);
});

test('tests run with the services the emulators expect', () => {
  assert.match(config.services.postgres.image, /^postgres:16/);
  assert.match(config.services.dynamodb.image, /^amazon\/dynamodb-local/);
  assert.match(config.services.valkey.image, /^valkey\/valkey:8/);
});

test('the test task lists its packages instead of filtering them in the shell', () => {
  const task = config.tasks.find((t) => t.name === 'test');
  assert.ok(Array.isArray(task.packages) && task.packages.length > 0, 'test task has a packages list');
  assert.doesNotMatch(task.run, /\bcase\b/);
});

test('a changeset-only PR is not ignored, so the changeset check still runs on it', () => {
  assert.equal(config.ignore.includes('.changeset/'), false);
});
