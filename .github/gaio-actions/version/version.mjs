#!/usr/bin/env node
// Turns pending changesets on main into a release PR, and lists the apps whose version is not tagged yet.
//
//   pending   pending=true when any changeset (empty ones included) is on disk
//   prepare   force-push release/main (main + the version command) and open or update its PR to main,
//             then dispatch PR_WORKFLOW on it; with nothing pending, close that PR. opened, pr
//   untagged  release units whose rendered tag is not on origin; apps, max-parallel (1 when config.serial), serial
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { notesFor, renderTag } from '../release-tag/release-tag.mjs';

const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const RELEASE_BRANCH = 'release/main';

export function bumpedApps(before, after) {
  return Object.keys(after).filter((dir) => before[dir] !== after[dir]).sort();
}

export const MAX_BODY = 60000;
const FOOTER = 'Merge with squash to release; the merge deploys demo → prd → tag.';
const shortName = (name) => renderTag('{name}', { name, version: '' });

export function releaseTitle(rows) {
  if (rows.length === 0) return 'chore(release): consume changesets';
  return `chore(release): ${rows.map((row) => `${shortName(row.name)} ${row.to}`).join(', ')}`;
}

export function releaseBody(rows) {
  if (rows.length === 0) return `No app version changes.\n\n${FOOTER}`;
  const table = ['| App | Version |', '| --- | --- |', ...rows.map((row) => `| \`${shortName(row.name)}\` | ${row.from} → ${row.to} |`)].join('\n');
  const notes = rows
    .map((row) => `<details>\n<summary>${shortName(row.name)} ${row.to}</summary>\n\n${row.notes || 'No changelog entry.'}\n\n</details>`)
    .join('\n\n');
  const full = `${table}\n\n${notes}\n\n${FOOTER}`;
  return full.length <= MAX_BODY ? full : `${table}\n\nChangelogs omitted: the body would exceed GitHub's limit.\n\n${FOOTER}`;
}

export function units(apps) {
  return apps.map((app) => {
    const unit = typeof app === 'string' ? { dir: app } : app;
    return { name: unit.name ?? basename(unit.dir), dir: unit.dir, tag: unit.tag ?? '{package}@{version}', demo: unit.demo, prd: unit.prd };
  });
}

/** A stage's own command, `deploy` when it has none, or null when the unit sets it to null to skip it. */
export function stageCommand(unit, deploy, stage) {
  const own = stage === 'stg' ? unit.demo : unit.prd;
  if (own === null) return null;
  return own ?? deploy;
}

export function untaggedApps(items, existingTags) {
  const tags = new Set(existingTags);
  return items
    .map((item) => ({ ...item, rendered: renderTag(item.tag, { name: item.package, version: item.version }) }))
    .filter((item) => !tags.has(item.rendered))
    .map(({ name, dir, package: pkg, rendered, demoCommand }) => ({ name, dir, package: pkg, tag: rendered, demo: demoCommand !== null }));
}

const basicCredential = (token) => Buffer.from(`x-access-token:${token}`).toString('base64');

export function authHeader(token) {
  return `AUTHORIZATION: basic ${basicCredential(token)}`;
}

export function maskCommand(token) {
  return `::add-mask::${basicCredential(token)}`;
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

export function lsRemoteArgs(token) {
  const auth = token ? ['-c', `http.https://github.com/.extraheader=${authHeader(token)}`] : [];
  return [...auth, 'ls-remote', '--tags', 'origin'];
}

export const remoteTags = (token) =>
  run('git', lsRemoteArgs(token))
    .split('\n')
    .map((line) => line.split('\t')[1]?.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''))
    .filter(Boolean);

const output = (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};

const readPackages = (dirs) =>
  Object.fromEntries(dirs.map((dir) => [dir, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))]));

const versions = (packages) => Object.fromEntries(Object.entries(packages).map(([dir, pkg]) => [dir, pkg.version]));

const hasPendingChangesets = () => readdirSync('.changeset').some((file) => file.endsWith('.md') && file !== 'README.md');

const openReleasePr = () =>
  run('gh', ['pr', 'list', '--head', RELEASE_BRANCH, '--base', 'main', '--state', 'open', '--json', 'url', '--jq', '.[0].url // ""']);

function closeReleasePr() {
  const pr = openReleasePr();
  if (pr) run('gh', ['pr', 'close', pr, '--delete-branch', '--comment', 'No changesets are pending on main.']);
  output('opened', false);
  output('pr', '');
}

function pushReleaseBranch() {
  const token = process.env.GITHUB_TOKEN;
  if (process.env.GITHUB_ACTIONS === 'true') console.log(maskCommand(token));
  run('git', [
    '-c', `http.https://github.com/.extraheader=${authHeader(token)}`,
    'push', '--force', 'origin', `HEAD:refs/heads/${RELEASE_BRANCH}`
  ]);
}

function prepare() {
  if (!hasPendingChangesets()) return closeReleasePr();

  const dirs = JSON.parse(process.env.APPS);
  const before = readPackages(dirs);
  run('git', ['checkout', '-q', '-B', RELEASE_BRANCH]);
  execFileSync('bash', ['-c', process.env.VERSION_COMMAND], { stdio: 'inherit' });
  const after = readPackages(dirs);
  const changelogNotes = (dir, version) => (existsSync(join(dir, 'CHANGELOG.md')) ? notesFor(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), version) : '');
  const rows = bumpedApps(versions(before), versions(after)).map((dir) => ({
    name: after[dir].name,
    from: before[dir].version,
    to: after[dir].version,
    notes: changelogNotes(dir, after[dir].version)
  }));

  run('git', ['add', '-A']);
  if (spawnSync('git', ['diff', '--cached', '--quiet']).status === 0) return closeReleasePr();
  const title = releaseTitle(rows);
  run('git', ['-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`, 'commit', '--no-verify', '-q', '-m', title]);
  pushReleaseBranch();

  const body = releaseBody(rows);
  let pr = openReleasePr();
  if (pr) run('gh', ['pr', 'edit', pr, '--title', title, '--body', body]);
  else pr = run('gh', ['pr', 'create', '--base', 'main', '--head', RELEASE_BRANCH, '--title', title, '--body', body]);
  // A PR opened with GITHUB_TOKEN triggers no pull_request workflow; workflow_dispatch is the exception.
  run('gh', ['workflow', 'run', process.env.PR_WORKFLOW, '--ref', RELEASE_BRANCH]);

  output('opened', true);
  output('pr', pr);
}

function untagged() {
  const config = JSON.parse(readFileSync(process.env.CONFIG, 'utf8'));
  const items = units(config.apps).map((unit, i) => {
    const pkg = JSON.parse(readFileSync(join(unit.dir, 'package.json'), 'utf8'));
    const name = unit.dir === '.' && !config.apps[i].name ? renderTag('{name}', pkg) : unit.name;
    return { ...unit, name, package: pkg.name, version: pkg.version, demoCommand: stageCommand(unit, config.deploy, 'stg') };
  });
  output('apps', JSON.stringify(untaggedApps(items, remoteTags())));
  output('max-parallel', config.serial === true ? 1 : 20);
  output('serial', config.serial === true);
}

function main([command]) {
  switch (command) {
    case 'pending':
      return output('pending', hasPendingChangesets());
    case 'prepare':
      return prepare();
    case 'untagged':
      return untagged();
    default:
      throw new Error('usage: version.mjs pending | prepare | untagged');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
