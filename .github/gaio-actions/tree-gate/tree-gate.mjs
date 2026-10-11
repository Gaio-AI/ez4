#!/usr/bin/env node
// A tree that passed the suite is never tested again. Every job that validates a tree posts the
// `Tested tree` commit status (description = tree sha); later stages look it up instead of rerunning.
//
//   record <sha>  post `Tested tree` = HEAD^{tree} on <sha> (a PR run posts its merge tree on the PR head)
//   check <sha>   tested=true when <sha>, the PR head it merged or a merged parent carries <sha>'s tree
//   quick <sha>   post `Quick checks` = STATE (success | failure) on <sha>, the status a PR merges on
//
// Any API failure answers "not tested": the caller then runs the full suite.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CONTEXT = 'Tested tree';

/**
 * What a pull request must pass to merge: lint and the config's quick legs, never the full suite,
 * which runs once on the tree a release ships.
 */
export const QUICK_CONTEXT = 'Quick checks';

export function quickStatus(state) {
  if (state === 'success') return { state, description: 'lint, typecheck and the quick checks passed' };
  if (state === 'failure') return { state, description: 'a quick check failed; see the run' };
  throw new Error(`state: success or failure, got ${state}`);
}

/** Statuses come newest first, so only the latest `Tested tree` status counts. */
export function carriesTree(statuses, tree) {
  const latest = statuses.find((status) => status.context === CONTEXT);
  return latest?.state === 'success' && latest.description === tree;
}

/** The pull request whose merge (squash or merge commit) produced `sha`. */
export function pullFor(pulls, sha) {
  return pulls.find((pull) => pull.merge_commit_sha === sha);
}

/**
 * Commits whose validation also covers `sha`: itself (a re-run), the merged PR head and every parent
 * after the first.
 */
export function candidates(sha, parents, pull) {
  return [sha, ...(pull ? [pull.head.sha] : []), ...parents.slice(1)];
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

const api = (path) => JSON.parse(run('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/${path}`]));

const attempt = (read, fallback) => {
  try {
    return read();
  } catch (error) {
    console.error(`::warning::${error.message.split('\n')[0]}`);
    return fallback;
  }
};

const statusesOf = (sha) => attempt(() => api(`commits/${sha}/statuses?per_page=100`), []);

const pullsOf = (sha) => attempt(() => api(`commits/${sha}/pulls`), []);

const output = (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};

function main([command, sha]) {
  if (!sha) throw new Error('usage: tree-gate.mjs record|check <sha>');

  switch (command) {
    case 'record': {
      const tree = run('git', ['rev-parse', 'HEAD^{tree}']);
      run('gh', [
        'api',
        '--method',
        'POST',
        `repos/${process.env.GITHUB_REPOSITORY}/statuses/${sha}`,
        '-f',
        'state=success',
        '-f',
        `context=${CONTEXT}`,
        '-f',
        `description=${tree}`
      ]);
      return output('tree', tree);
    }
    case 'quick': {
      const { state, description } = quickStatus(process.env.STATE ?? '');
      run('gh', [
        'api',
        '--method',
        'POST',
        `repos/${process.env.GITHUB_REPOSITORY}/statuses/${sha}`,
        '-f',
        `state=${state}`,
        '-f',
        `context=${QUICK_CONTEXT}`,
        '-f',
        `description=${description}`,
        '-f',
        `target_url=${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      ]);
      return output('state', state);
    }
    case 'check': {
      const tree = run('git', ['rev-parse', `${sha}^{tree}`]);
      const parents = run('git', ['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1);
      const pull = pullFor(pullsOf(sha), sha);
      return output('tested', candidates(sha, parents, pull).some((commit) => carriesTree(statusesOf(commit), tree)));
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
