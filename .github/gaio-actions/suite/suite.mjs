#!/usr/bin/env node
// Runs the planned legs of a suite one after another in a single job, so a run pays one checkout,
// one install and one start of the services instead of one per leg. Every leg runs even after a
// failure, so one run reports every broken leg; the passed ones are marked for the validated cache.
//
//   LEGS          the task legs `validated plan` printed
//   CHECKS        the extra check legs `validated plan` printed
//   LINT_COMMAND  the config's lint command, when the plan needs it (LINT_HASH names it)
//   PASSED_DIR    where `<hash>__<index>` is written for each leg that passed
//   NAMES         the stage names the plan resolved from the config, for the log groups
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { DEFAULT_NAMES } from '../validated/names.mjs';

export function orderLegs({ lint, legs, checks }) {
  return [
    ...(lint ? [{ kind: 'lint', label: 'lint', run: lint.run, prepare: '', hash: lint.hash, index: 0 }] : []),
    ...legs.map((leg) => ({ ...leg, kind: 'task' })),
    ...checks.map((check) => ({ ...check, kind: 'check', prepare: '', index: 0 }))
  ];
}

/** The log group of one command, titled with the stage names of the config (`names`). */
export function groupTitle(leg, step, names) {
  if (leg.kind === 'lint') return names.lint;
  if (leg.kind === 'check') return `${names.check} ${leg.label}`;
  return `${step === 'prepare' ? names.prepare : names.run} ${leg.label}`;
}

/**
 * @param exec runs a shell command and answers its exit code
 * @param clock answers seconds, for the summary
 */
export function runLegs(legs, exec, clock = () => 0) {
  const passed = [];
  const failed = [];
  const results = [];
  for (const leg of legs) {
    const started = clock();
    const code = (leg.prepare ? exec(leg.prepare, leg, 'prepare') : 0) || exec(leg.run, leg, 'run');
    const status = code === 0 ? 'passed' : leg.advisory ? 'failed (advisory)' : 'failed';
    if (code === 0) passed.push(`${leg.hash}__${leg.index}`);
    else if (!leg.advisory) failed.push(leg.label);
    results.push({ label: leg.label, status, seconds: clock() - started });
  }
  return { passed, failed, results, ok: failed.length === 0 };
}

export function summaryTable(results) {
  const rows = results.map(({ label, status, seconds }) => `| ${label} | ${status} | ${Math.round(seconds)} |`);
  return ['| leg | result | seconds |', '| --- | --- | ---: |', ...rows, ''].join('\n');
}

function main() {
  const { LEGS = '[]', CHECKS = '[]', LINT_COMMAND = '', LINT_HASH = '', PASSED_DIR = 'passed', NAMES = '{}' } = process.env;
  const names = { ...DEFAULT_NAMES, ...JSON.parse(NAMES) };
  const legs = orderLegs({
    lint: LINT_COMMAND && LINT_HASH ? { run: LINT_COMMAND, hash: LINT_HASH } : undefined,
    legs: JSON.parse(LEGS),
    checks: JSON.parse(CHECKS)
  });

  const exec = (command, leg, step) => {
    console.log(`::group::${groupTitle(leg, step, names)}`);
    const { status } = spawnSync('bash', ['-c', command], { stdio: 'inherit', env: { ...process.env, BASE_REF: process.env.GITHUB_BASE_REF ?? '' } });
    console.log('::endgroup::');
    if (status !== 0) console.log(`::error title=${leg.label}::exited with ${status}`);
    return status ?? 1;
  };

  const { passed, failed, results, ok } = runLegs(legs, exec, () => performance.now() / 1000);

  mkdirSync(PASSED_DIR, { recursive: true });
  for (const marker of passed) writeFileSync(`${PASSED_DIR}/${marker}`, '');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryTable(results));
  if (!ok) {
    console.log(`Failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
