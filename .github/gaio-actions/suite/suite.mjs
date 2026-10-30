#!/usr/bin/env node
// Runs the planned legs of a suite in a single job, so a run pays one checkout, one install and one
// start of the services instead of one per leg. The first blocking failure stops the run, so a broken
// leg never waits behind the rest; the legs that passed before it are marked for the validated cache.
// An advisory leg that fails is reported and the run goes on.
//
// With CONCURRENCY above 1 the legs run that many at a time, in plan order: each command's output is
// held and printed as one log group when it ends, so groups never interleave. After a blocking failure
// no new leg starts, and the legs already running finish.
//
//   LEGS          the task legs `validated plan` printed
//   CHECKS        the extra check legs `validated plan` printed
//   LINT_COMMAND  the config's lint command, when the plan needs it (LINT_HASH names it)
//   PASSED_DIR    where `<hash>__<index>` is written for each leg that passed
//   NAMES         the stage names the plan resolved from the config, for the log groups
//   CONCURRENCY   how many legs run at once (default 1: one after another, output streamed live)
import { spawn, spawnSync } from 'node:child_process';
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

const legStatus = (leg, code) => (code === 0 ? 'passed' : leg.advisory ? 'failed (advisory)' : 'failed');

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
    if (code === 0) passed.push(`${leg.hash}__${leg.index}`);
    else if (!leg.advisory) failed.push(leg.label);
    results.push({ label: leg.label, status: legStatus(leg, code), seconds: clock() - started });
    if (failed.length > 0) break;
  }
  return { passed, failed, results, ok: failed.length === 0 };
}

/**
 * Runs the legs `concurrency` at a time, taking them in plan order. The results come back in plan order.
 *
 * @param exec runs a shell command and resolves to its exit code
 * @param clock answers seconds, for the summary
 */
export async function runLegsConcurrently(legs, exec, { concurrency, clock = () => 0 }) {
  const passed = [];
  const failed = [];
  const results = [];
  const queue = legs.map((leg, position) => ({ leg, position }));

  const worker = async () => {
    while (queue.length > 0 && failed.length === 0) {
      const { leg, position } = queue.shift();
      const started = clock();
      const code = (leg.prepare ? await exec(leg.prepare, leg, 'prepare') : 0) || (await exec(leg.run, leg, 'run'));
      if (code === 0) passed.push(`${leg.hash}__${leg.index}`);
      else if (!leg.advisory) failed.push(leg.label);
      results.push({ position, label: leg.label, status: legStatus(leg, code), seconds: clock() - started });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, legs.length) }, worker));

  results.sort((a, b) => a.position - b.position);
  return { passed, failed, results: results.map(({ position: _position, ...result }) => result), ok: failed.length === 0 };
}

export function summaryTable(results) {
  const rows = results.map(({ label, status, seconds }) => `| ${label} | ${status} | ${Math.round(seconds)} |`);
  return ['| leg | result | seconds |', '| --- | --- | ---: |', ...rows, ''].join('\n');
}

async function main() {
  const { LEGS = '[]', CHECKS = '[]', LINT_COMMAND = '', LINT_HASH = '', PASSED_DIR = 'passed', NAMES = '{}', CONCURRENCY = '1' } = process.env;
  const names = { ...DEFAULT_NAMES, ...JSON.parse(NAMES) };
  const concurrency = Math.max(1, Number.parseInt(CONCURRENCY, 10) || 1);
  const legs = orderLegs({
    lint: LINT_COMMAND && LINT_HASH ? { run: LINT_COMMAND, hash: LINT_HASH } : undefined,
    legs: JSON.parse(LEGS),
    checks: JSON.parse(CHECKS)
  });
  const env = { ...process.env, BASE_REF: process.env.GITHUB_BASE_REF ?? '' };

  const exec = (command, leg, step) => {
    console.log(`::group::${groupTitle(leg, step, names)}`);
    const { status } = spawnSync('bash', ['-c', command], { stdio: 'inherit', env });
    console.log('::endgroup::');
    if (status !== 0) console.log(`::error title=${leg.label}::exited with ${status}`);
    return status ?? 1;
  };

  const execHeld = (command, leg, step) =>
    new Promise((resolve) => {
      const output = [];
      const child = spawn('bash', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], env });
      child.stdout.on('data', (chunk) => output.push(chunk));
      child.stderr.on('data', (chunk) => output.push(chunk));
      child.on('close', (code) => {
        const status = code ?? 1;
        const text = Buffer.concat(output).toString();
        process.stdout.write(`::group::${groupTitle(leg, step, names)}\n${text}${text.endsWith('\n') || !text ? '' : '\n'}::endgroup::\n`);
        if (status !== 0) console.log(`::error title=${leg.label}::exited with ${status}`);
        resolve(status);
      });
    });

  const clock = () => performance.now() / 1000;
  const { passed, failed, results, ok } =
    concurrency === 1 ? runLegs(legs, exec, clock) : await runLegsConcurrently(legs, execHeld, { concurrency, clock });

  mkdirSync(PASSED_DIR, { recursive: true });
  for (const marker of passed) writeFileSync(`${PASSED_DIR}/${marker}`, '');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryTable(results));
  if (!ok) {
    console.log(`Failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
