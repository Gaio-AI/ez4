#!/usr/bin/env node
// Ships release units one after another, each demo → prd → tag, and stops at the first failure.
//
//   ship.mjs   reads CONFIG, UNITS (the `untagged` apps JSON) and SHA
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { authHeader, maskCommand, remoteTags, stageCommand, units } from '../version/version.mjs';

const RELEASE_TAG = fileURLToPath(new URL('../release-tag/release-tag.mjs', import.meta.url));

export function shipSteps(units) {
  return units.flatMap((unit) => [
    ...(unit.demo ? [{ unit, stage: 'stg' }] : []),
    { unit, stage: 'prd' },
    { unit, stage: 'tag' }
  ]);
}

export function pendingUnits(units, existingTags) {
  const tags = new Set(existingTags);
  return units.filter((unit) => !tags.has(unit.tag));
}

export async function runSteps(steps, execute) {
  const done = [];
  for (const step of steps) {
    try {
      await execute(step);
    } catch {
      return { done, failed: step };
    }
    done.push(step);
  }
  return { done, failed: null };
}

/** The child env of one step: a stage gets only its own Doppler token, the tag step only the push token. */
export function stepEnv(stage, env) {
  const { DOPPLER_STG_TOKEN, DOPPLER_PRD_TOKEN, GH_TOKEN, ...rest } = env;
  if (stage === 'stg') return { ...rest, DOPPLER_TOKEN: DOPPLER_STG_TOKEN };
  if (stage === 'prd') return { ...rest, DOPPLER_TOKEN: DOPPLER_PRD_TOKEN };
  return {
    ...rest,
    GH_TOKEN,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: authHeader(GH_TOKEN ?? '')
  };
}

async function main() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== process.env.SHA) throw new Error(`HEAD ${head} is not the release commit ${process.env.SHA}`);

  if (process.env.GITHUB_ACTIONS === 'true') console.log(maskCommand(process.env.GH_TOKEN));

  const config = JSON.parse(readFileSync(process.env.CONFIG, 'utf8'));
  const configured = new Map(units(config.apps).map((unit) => [unit.dir, unit]));
  const execute = ({ unit, stage }) => {
    console.log(`::group::${unit.name} ${stage}`);
    try {
      const env = stepEnv(stage, process.env);
      if (stage === 'tag') {
        execFileSync('node', [RELEASE_TAG, unit.dir, configured.get(unit.dir).tag], { stdio: 'inherit', env });
        return;
      }
      const command = stageCommand(configured.get(unit.dir), config.deploy, stage);
      if (command === null) return console.log(`${stage} is skipped for ${unit.dir}`);
      execFileSync('bash', ['-c', command.replaceAll('{app}', unit.name).replaceAll('{env}', stage)], { stdio: 'inherit', env });
    } finally {
      console.log('::endgroup::');
    }
  };

  const planned = JSON.parse(process.env.UNITS);
  const pending = pendingUnits(planned, remoteTags(process.env.GH_TOKEN));
  for (const unit of planned) if (!pending.includes(unit)) console.log(`${unit.name} is already tagged ${unit.tag}; skipping`);

  const { failed } = await runSteps(shipSteps(pending), execute);
  if (failed) {
    console.log(`::error::${failed.unit.name} failed at ${failed.stage}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
