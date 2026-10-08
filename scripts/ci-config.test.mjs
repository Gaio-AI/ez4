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
  assert.deepEqual(config.apps, [{ dir: 'foundation/utils', tag: 'v{version}', demo: null, prd: 'npm run release' }]);
  assert.ok(JSON.parse(read('package.json')).scripts.release, 'root release script exists');
});

test('tests run with the services the emulators expect', () => {
  assert.match(config.services.postgres.image, /^postgres:16/);
  assert.match(config.services.dynamodb.image, /^amazon\/dynamodb-local/);
  assert.match(config.services.valkey.image, /^valkey\/valkey:8/);
});
