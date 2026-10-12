import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = JSON.parse(readFileSync('.github/gaio-ci.json', 'utf8'));
const read = (path) => readFileSync(path, 'utf8');

test('the develop flow is gone and the callers use the local gaio-actions copy', () => {
  for (const path of ['.github/actions/tree-gate', '.github/actions/changeset-release']) assert.equal(existsSync(path), false, path);
  for (const file of ['.github/workflows/pr.yml', '.github/workflows/release.yml']) {
    assert.match(read(file), /uses: \.\/\.github\/workflows\/gaio-(pr|release)\.yml/);
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

test('no workflow calls the private gaio-actions repo, which a public repo cannot reach', () => {
  for (const file of readdirSync('.github/workflows')) {
    assert.doesNotMatch(read(`.github/workflows/${file}`), /Gaio-AI\/gaio-actions/, file);
  }
});

test('a manual release runs only on main, so a dispatch from another branch never deploys it', () => {
  const release = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(release, /^  workflow_dispatch:/m);
  assert.match(release, /^    if: github\.ref == 'refs\/heads\/main'$/m);
});

test('the build outputs are cached by relative globs that cover every dist and tsbuildinfo the build writes', () => {
  const paths = config['build-cache'];
  assert.ok(Array.isArray(paths) && paths.length > 0, 'build-cache is a non-empty list');
  for (const path of paths) assert.ok(!path.startsWith('/') && !path.split('/').includes('..'), path);
  for (const needle of ['foundation/*/dist', 'providers/*/*/dist', 'foundation/project/bin/*.mjs']) assert.ok(paths.includes(needle), needle);
  assert.ok(paths.some((path) => path.endsWith('tsconfig.pack.tsbuildinfo')));
});

test('lint builds first, lints every workspace and still runs this config test', () => {
  const { lint } = config;
  assert.ok(lint.startsWith('bash scripts/ci-build-once.sh && '), 'build before lint');
  assert.match(lint, /npm run lint -w \{\}/);
  assert.match(lint, /node --test scripts\/ci-config\.test\.mjs/);
  assert.match(lint, /-P "\$\(nproc\)"/);
});

test('the suite builds once per job: lint and every test leg share one build', () => {
  const task = config.tasks.find((t) => t.name === 'test');
  assert.deepEqual(task.prepare, { '*': 'bash scripts/ci-build-once.sh' });
  assert.ok(config['shared-inputs'].includes('scripts/ci-build-once.sh'));
  const script = read('scripts/ci-build-once.sh');
  assert.match(script, /RUNNER_TEMP/);
  assert.ok(script.indexOf('npm run build') < script.indexOf('npm link -w @ez4/project'), 'build before link');
});

// The suite holds the CI credentials, so the offline specs run against a dead endpoint with fake keys, and a
// profile (which the SDK would take over the keys) or a credentials file can't bring a real account back.
const OFFLINE_TEST =
  "npm run build && tsc -p tsconfig.test.json --noEmit && AWS_ENDPOINT_URL=http://127.0.0.1:9 AWS_ACCESS_KEY_ID=offline AWS_SECRET_ACCESS_KEY=offline AWS_SESSION_TOKEN= AWS_REGION=us-east-1 AWS_PROFILE= AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null ez4 test -- '!.lab.spec'";

const specFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return ['node_modules', 'dist'].includes(entry.name) ? [] : specFiles(`${dir}/${entry.name}`);
    return /\.(spec|test)\.(js|ts)$/.test(entry.name) ? [`${dir}/${entry.name}`] : [];
  });

test('every aws provider spec not named *.lab.spec.ts runs in the suite, with AWS out of reach', () => {
  const task = config.tasks.find((t) => t.name === 'test-offline');
  assert.ok(task, 'test-offline task');
  assert.equal(task.script, 'test:offline');
  assert.equal(task.run, 'npm run test:offline -w {package}');
  assert.deepEqual(task.prepare, { '*': 'bash scripts/ci-build-once.sh' });

  const offline = readdirSync('providers/aws')
    .map((dir) => `providers/aws/${dir}`)
    .filter((dir) => specFiles(dir).some((file) => !file.includes('.lab.spec')))
    .map((dir) => JSON.parse(read(`${dir}/package.json`)));

  for (const { name, scripts } of offline) assert.equal(scripts['test:offline'], OFFLINE_TEST, name);
  assert.deepEqual([...task.packages].sort(), offline.map(({ name }) => name).sort());
});

test('the callers grant id-token (the copied workflows request it) and the PR caller passes its mode', () => {
  for (const file of ['.github/workflows/pr.yml', '.github/workflows/release.yml']) assert.match(read(file), /^      id-token: write$/m, file);
  assert.match(read('.github/workflows/pr.yml'), /mode: \$\{\{ inputs\.mode \|\| 'quick' \}\}/);
});
