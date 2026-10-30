#!/usr/bin/env node
// Starts the config's `services` as docker containers and waits until each accepts connections.
//
//   CONFIG=.github/gaio-ci.json services.mjs
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// A private ECR registry refuses an anonymous pull; the public ones keep pulling without a login.
const ECR_REGISTRY = /^(\d{12}\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com)\//;
const ATTEMPTS = 60;
const INTERVAL_MS = 2000;
const START_ATTEMPTS = 18;
const START_INTERVAL_MS = 5000;

export function dockerRunArgs(slot, spec) {
  const ports = (spec.ports ?? []).flatMap((port) => ['-p', port]);
  const env = Object.entries(spec.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return ['run', '-d', '--name', slot, ...ports, ...env, ...(spec.args ?? []), spec.image];
}

export function hostPorts(services) {
  const ports = Object.values(services).flatMap((spec) => (spec.ports ?? []).map((port) => Number(port.split(':')[0])));
  return [...new Set(ports)];
}

export function ecrRegistries(services) {
  const registries = new Map();
  for (const spec of Object.values(services)) {
    const match = ECR_REGISTRY.exec(spec.image ?? '');
    if (match) registries.set(match[1], match[2]);
  }
  return [...registries].map(([host, region]) => ({ host, region }));
}

// Logs docker in with the credentials of the role the job assumed, which the action gets as AWS_* variables.
function login({ host, region }) {
  const password = execFileSync('aws', ['ecr', 'get-login-password', '--region', region], { encoding: 'utf8' });
  execFileSync('docker', ['login', '--username', 'AWS', '--password-stdin', host], { input: password, stdio: ['pipe', 'inherit', 'inherit'] });
}

export function portTaken(dockerError) {
  return dockerError.includes('address already in use');
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

// Host ports such as 54320 sit inside Linux's ephemeral range (32768-60999), so an earlier
// outgoing connection on the runner can hold one when docker binds it.
function reservePorts(ports) {
  try {
    execFileSync('sudo', ['sysctl', '-qw', `net.ipv4.ip_local_reserved_ports=${ports.join(',')}`], { stdio: 'inherit' });
  } catch {
    console.log('could not reserve the service ports; a taken port is retried instead');
  }
}

async function start(slot, spec) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync('docker', dockerRunArgs(slot, spec), { stdio: ['ignore', 'inherit', 'pipe'] });
    } catch (error) {
      const stderr = String(error.stderr ?? '');
      process.stderr.write(stderr);
      if (!portTaken(stderr) || attempt === START_ATTEMPTS) throw error;
      execFileSync('docker', ['rm', '-f', slot], { stdio: 'ignore' });
      console.log(`${slot}: host port taken, retrying in ${START_INTERVAL_MS / 1000}s (${attempt}/${START_ATTEMPTS})`);
      await sleep(START_INTERVAL_MS);
    }
  }
}

async function main() {
  const { CONFIG = '.github/gaio-ci.json' } = process.env;
  const services = JSON.parse(readFileSync(CONFIG, 'utf8')).services ?? {};
  if (Object.keys(services).length === 0) return;
  const registries = ecrRegistries(services);
  for (const registry of registries) login(registry);
  reservePorts(hostPorts(services));
  for (const [slot, spec] of Object.entries(services)) await start(slot, spec);
  // The images are pulled by now, and the legs that run the repo's code after this step need no registry token.
  for (const { host } of registries) execFileSync('docker', ['logout', host], { stdio: 'ignore' });
  for (const [slot, spec] of Object.entries(services)) await waitReady(slot, readyProbe(slot, spec));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
