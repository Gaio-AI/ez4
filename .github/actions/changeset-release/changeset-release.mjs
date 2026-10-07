#!/usr/bin/env node
// The release PR: on every push to develop, release.yml rebuilds `changeset-release/develop` as
// develop + a merge of main + `changeset version`, tests and deploys that tree to stg, and keeps one
// PR from it into main. Merging that PR (merge commit) releases to prd. Every push here uses
// GITHUB_TOKEN, which starts no workflow, so the run that pushes the branch also tests it.
//
//   prepare <sha>  check out the release branch at <sha> and merge origin/main into it
//   pending        pending=true when a changeset on disk releases a package
//   publish <title> commit the versioned tree, push it unless the remote head has the same tree and
//                  contains main, open or update the PR into main; sha=<release branch head>
//   close          close the open release PR (nothing left to release)
//   hotfix <base>  fail unless the hotfix branch was versioned: no pending changeset, a bumped version
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BRANCH = 'changeset-release/develop';

const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

/** Packages a changeset releases: the lines of its front matter (an empty changeset has none). */
export function releasesIn(markdown) {
  const match = /^---\r?\n([\s\S]*?)^---/m.exec(markdown);
  if (!match || markdown.slice(0, match.index).trim()) return 0;
  return match[1].split('\n').filter((line) => line.trim()).length;
}

/** True when a `git diff` of package.json files changes a top-level "version". */
export function versionBumped(diff) {
  return /^[+-]\s*"version"\s*:/m.test(diff);
}

const SYNC_REMEDY =
  'Create a sync/* branch from develop, merge main into it, resolve, and merge its PR into develop with a ' +
  'merge commit. The next push to develop rebuilds the release PR.';

export function conflictMessage(files) {
  return `main conflicts with develop in ${files.join(', ')}. ${SYNC_REMEDY}`;
}

export function hotfixProblems({ pending, bumped }) {
  const problems = [];
  if (pending.length > 0) {
    problems.push(`run \`changeset version\` in the hotfix branch: ${pending.join(', ')} not consumed`);
  }
  if (!bumped) problems.push('a hotfix ships a version: add a changeset, then run `changeset version`');
  return problems;
}

export function prBody(develop) {
  return [
    `develop at ${develop}, merged with main and versioned by \`changeset version\`. release.yml rebuilds this branch on every push to develop and deploys it to stg; do not push to it.`,
    '',
    'Merge with **Create a merge commit**: tags, GitHub Releases and the prd deploy follow. The `Tested tree` status on the head commit means this tree passed the suite.'
  ].join('\n');
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

const succeeds = (command, args) => {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const output = (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};

const pendingChangesets = () =>
  readdirSync('.changeset')
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .filter((file) => releasesIn(readFileSync(join('.changeset', file), 'utf8')) > 0);

const openPull = () =>
  run('gh', ['pr', 'list', '--head', BRANCH, '--base', 'main', '--state', 'open', '--json', 'number', '--jq', '.[0].number // empty']);

function main([command, argument]) {
  switch (command) {
    case 'prepare': {
      run('git', ['config', 'user.name', BOT_NAME]);
      run('git', ['config', 'user.email', BOT_EMAIL]);
      run('git', ['checkout', '-q', '-B', BRANCH, argument]);
      try {
        run('git', ['merge', '--no-edit', '-m', `Merge main into ${BRANCH}`, 'origin/main']);
      } catch {
        const files = run('git', ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
        run('git', ['merge', '--abort']);
        console.error(`::error::${conflictMessage(files)}`);
        process.exit(1);
      }
      return;
    }
    case 'pending':
      return output('pending', pendingChangesets().length > 0);
    case 'publish': {
      run('git', ['add', '-A']);
      run('git', ['commit', '--no-verify', '-q', '-m', argument]);
      // HEAD^ is the merge of main, or develop itself when it already contained main.
      const merged = run('git', ['rev-list', '--parents', '-n', '1', 'HEAD^']).split(' ').length === 3;
      const develop = run('git', ['rev-parse', merged ? 'HEAD^^1' : 'HEAD^']);
      let sha = run('git', ['rev-parse', 'HEAD']);
      const remote = run('git', ['ls-remote', 'origin', `refs/heads/${BRANCH}`]).split('\t')[0];
      if (remote) run('git', ['fetch', '-q', 'origin', remote]);
      const same =
        remote &&
        run('git', ['rev-parse', `${remote}^{tree}`]) === run('git', ['rev-parse', 'HEAD^{tree}']) &&
        succeeds('git', ['merge-base', '--is-ancestor', 'origin/main', remote]);
      if (same) sha = remote;
      else if (!succeeds('git', ['push', '-q', '--force', 'origin', `HEAD:refs/heads/${BRANCH}`])) {
        console.error(`::error::GitHub refused the push of ${BRANCH}. ${SYNC_REMEDY}`);
        process.exit(1);
      }
      const number = openPull();
      if (number) run('gh', ['pr', 'edit', number, '--title', argument, '--body', prBody(develop)]);
      else run('gh', ['pr', 'create', '--base', 'main', '--head', BRANCH, '--title', argument, '--body', prBody(develop)]);
      return output('sha', sha);
    }
    case 'close': {
      const number = openPull();
      if (number) run('gh', ['pr', 'close', number, '--delete-branch', '--comment', 'No pending changeset on develop.']);
      return;
    }
    case 'hotfix': {
      const diff = run('git', ['diff', `${argument}...HEAD`, '--', ':(glob)**/package.json']);
      const problems = hotfixProblems({ pending: pendingChangesets(), bumped: versionBumped(diff) });
      for (const problem of problems) console.error(`::error::${problem}`);
      if (problems.length > 0) process.exit(1);
      return;
    }
    default:
      throw new Error('usage: changeset-release.mjs prepare <sha> | pending | publish <title> | close | hotfix <base>');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
