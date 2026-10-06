#!/usr/bin/env node
// Merges a released main commit back into develop through a pull request.
//
//   back-merge.mjs <sha>
//
// Env: GITHUB_REPOSITORY, GH_TOKEN, DEVELOP_WORKFLOW (the workflow file that runs on develop).
// When main brings only the bot's release commit and the develop head it merged into had passed
// the suite, the merge commit gets the `Tested tree` status. Otherwise DEVELOP_WORKFLOW is
// dispatched on develop so the suite runs; when main brings code (a hotfix) the dispatch carries
// `deploy=all` and every refs/deploy/* ref is deleted, so stg/demo get the hotfix even if that run
// is superseded. Merges made with GITHUB_TOKEN fire no workflow, which is why this script does
// either. Safe to re-run: an existing branch, open or merged pull request is reused.
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { CONTEXT, carriesTree } from '../tree-gate/tree-gate.mjs';

const BOT = '41898282+github-actions[bot]@users.noreply.github.com';
const RELEASE_SUBJECT = /^(release[: ]|chore: version )/;

/** True when every line of `git log --no-merges --format=%ae%x09%s` is the bot's release commit. */
export function releaseOnly(log) {
  return log
    .split('\n')
    .filter(Boolean)
    .every((line) => {
      const [email, subject] = line.split('\t');
      return email === BOT && RELEASE_SUBJECT.test(subject);
    });
}

export const branchFor = (sha) => `back-merge/${sha.slice(0, 12)}`;

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

const succeeds = (command, args) => spawnSync(command, args, { encoding: 'utf8' }).status === 0;

/** Whether `sha` carries a passing `Tested tree` for its own tree; any API failure answers false. */
function tested(repo, sha) {
  try {
    const statuses = JSON.parse(run('gh', ['api', `repos/${repo}/commits/${sha}/statuses?per_page=100`]));
    return carriesTree(statuses, run('git', ['rev-parse', `${sha}^{tree}`]));
  } catch (error) {
    console.error(`::warning::${error.message.split('\n')[0]}`);
    return false;
  }
}

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
  const { GITHUB_REPOSITORY: repo, DEVELOP_WORKFLOW: workflow } = process.env;
  if (!workflow) throw new Error('DEVELOP_WORKFLOW is required');

  const branch = branchFor(sha);
  run('git', ['fetch', '--quiet', 'origin', 'develop']);
  // A re-run, or a merge a person finished after a conflict, continues from the merged PR.
  let mergeCommit = run('gh', ['pr', 'list', '--head', branch, '--base', 'develop', '--state', 'merged', '--json', 'mergeCommit', '--jq', '.[0].mergeCommit.oid // empty']);
  if (!mergeCommit) {
    if (succeeds('git', ['merge-base', '--is-ancestor', sha, 'origin/develop'])) {
      return console.log(`develop already contains ${sha}`);
    }
    mergeCommit = openAndMerge(sha, branch);
    run('git', ['fetch', '--quiet', 'origin', 'develop']);
  }

  // The merge commit's first parent is exactly the develop head it merged into, whatever landed since.
  const before = run('git', ['rev-parse', `${mergeCommit}^1`]);
  const code = !releaseOnly(run('git', ['log', '--no-merges', '--format=%ae%x09%s', `${before}..${sha}`]));
  if (!code && tested(repo, before)) {
    const tree = run('git', ['rev-parse', `${mergeCommit}^{tree}`]);
    run('gh', ['api', '--method', 'POST', `repos/${repo}/statuses/${mergeCommit}`, '-f', 'state=success', '-f', `context=${CONTEXT}`, '-f', `description=${tree}`]);
    return console.log(`${mergeCommit} brings only the release commit into a tested develop: recorded as tested`);
  }
  if (code) resetDeployRefs();
  run('gh', ['workflow', 'run', workflow, '--ref', 'develop', ...(code ? ['-f', 'deploy=all'] : [])]);
  console.log(`${mergeCommit} ${code ? 'brings code' : 'merged into an untested develop'}: ${workflow} dispatched on develop`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
