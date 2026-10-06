#!/usr/bin/env node
// Merges a released main commit back into develop through a pull request.
//
//   back-merge.mjs <sha>
//
// Env: GITHUB_REPOSITORY, GH_TOKEN (a gaio-code-agent App token: GITHUB_TOKEN cannot bypass the
// develop ruleset, and a merge made with it would start no workflow). The App's merge starts
// develop's release.yml, whose tree gate decides whether the suite runs (tree-gate.mjs `check`).
// When main brings code (a hotfix), every refs/deploy/* ref is deleted first, so stg/demo get the
// hotfix even if that develop run is superseded. Safe to re-run: an existing branch, open or merged
// pull request is reused.
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { releaseOnly } from '../tree-gate/tree-gate.mjs';

export const branchFor = (sha) => `back-merge/${sha.slice(0, 12)}`;

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

const succeeds = (command, args) => spawnSync(command, args, { encoding: 'utf8' }).status === 0;

function merge(url) {
  let error = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    const result = spawnSync('gh', ['pr', 'merge', url, '--merge', '--admin'], { encoding: 'utf8' });
    if (result.status === 0) return '';
    error = `${result.stderr}${result.stdout}`.trim();
    // GitHub computes mergeability asynchronously right after the PR is created.
    if (run('gh', ['pr', 'view', url, '--json', 'mergeable', '--jq', '.mergeable']) === 'CONFLICTING') break;
    if (attempt < 6) run('sleep', ['10']);
  }
  return error || 'merge failed';
}

function openAndMerge(sha, branch) {
  if (!succeeds('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch])) {
    run('git', ['push', 'origin', `${sha}:refs/heads/${branch}`]);
  }
  const url =
    run('gh', ['pr', 'list', '--head', branch, '--base', 'develop', '--state', 'open', '--json', 'url', '--jq', '.[0].url // empty']) ||
    run('gh', [
      'pr',
      'create',
      '--base',
      'develop',
      '--head',
      branch,
      '--title',
      `chore: back-merge main ${sha.slice(0, 12)} into develop`,
      '--body',
      `Brings \`main\` at ${sha} (release commit, tags and any hotfix) back into \`develop\`.`
    ]);

  const error = merge(url);
  if (error) {
    const fence = '```';
    run('gh', [
      'pr',
      'comment',
      url,
      '--body',
      `Automatic merge failed:\n\n${fence}\n${error}\n${fence}\n\nResolve it on \`${branch}\` and merge this PR with a merge commit, then re-run the failed \`🔁 Back-merge\`: the next release waits for it.`
    ]);
    throw new Error(`back-merge ${url} could not be merged: ${error}`);
  }
  return run('gh', ['pr', 'view', url, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid']);
}

/** stg/demo deploys diff from refs/deploy/*; without them the next develop run deploys everything. */
function resetDeployRefs() {
  const refs = run('git', ['ls-remote', '--refs', 'origin', 'refs/deploy/*'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1]);
  for (const ref of refs) run('git', ['push', 'origin', '--delete', ref]);
}

function main([sha]) {
  if (!sha) throw new Error('usage: back-merge.mjs <sha>');

  const branch = branchFor(sha);
  run('git', ['fetch', '--quiet', 'origin', 'develop']);
  // A re-run, or a merge a person finished after a conflict, finds the merged PR: its merge already
  // started develop's run.
  const merged = run('gh', ['pr', 'list', '--head', branch, '--base', 'develop', '--state', 'merged', '--json', 'url', '--jq', '.[0].url // empty']);
  if (merged) return console.log(`${merged} is already merged`);
  if (succeeds('git', ['merge-base', '--is-ancestor', sha, 'origin/develop'])) {
    return console.log(`develop already contains ${sha}`);
  }

  if (!releaseOnly(run('git', ['log', '--no-merges', '--format=%ae%x09%s', `origin/develop..${sha}`]))) resetDeployRefs();
  const mergeCommit = openAndMerge(sha, branch);
  console.log(`${mergeCommit} merged ${sha} into develop; develop's release.yml decides the suite`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
