#!/usr/bin/env node
// Starts the config's `services` as docker containers and waits until each accepts connections.
//
//   CONFIG=.github/gaio-ci.json services.mjs
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const ATTEMPTS = 60;
const INTERVAL_MS = 2000;

export function dockerRunArgs(slot, spec) {
  const ports = (spec.ports ?? []).flatMap((port) => ['-p', port]);
  const env = Object.entries(spec.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return ['run', '-d', '--name', slot, ...ports, ...env, ...(spec.args ?? []), spec.image];
}

export function readyProbe(slot, spec) {
  if (slot === 'postgres') return `docker exec ${slot} pg_isready -h 127.0.0.1 -U postgres`;
  const host = (spec.ports ?? [])[0]?.split(':')[0];
  return `bash -c 'exec 3<>/dev/tcp/127.0.0.1/${host}'`;
}

async function waitReady(slot, probe) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      execSync(probe, { stdio: 'ignore' });
      return console.log(`${slot} ready`);
    } catch {
      await sleep(INTERVAL_MS);
    }
  }
  execFileSync('docker', ['logs', slot], { stdio: 'inherit' });
  throw new Error(`${slot} not ready after ${ATTEMPTS} attempts`);
}

async function main() {
  const { CONFIG = '.github/gaio-ci.json' } = process.env;
  const services = JSON.parse(readFileSync(CONFIG, 'utf8')).services ?? {};
  for (const [slot, spec] of Object.entries(services)) execFileSync('docker', dockerRunArgs(slot, spec), { stdio: 'inherit' });
  for (const [slot, spec] of Object.entries(services)) await waitReady(slot, readyProbe(slot, spec));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
