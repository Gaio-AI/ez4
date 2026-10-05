import type { AddressInfo } from 'node:net';
import type { ProxyListenPlan } from './port';

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { join } from 'node:path';

import { ensureForwarder, isOwnProxy, planProxyListen, systemPortProbe } from './port';
import { getProxyHome } from './routes';

const FRONT_TIMEOUT = 5000;

// Both bin/cli.mjs and bin/application.mjs bundle this module, so the CLI sits beside the running bundle.
export const getCliPath = () => join(import.meta.dirname, 'cli.mjs');

const getLogsPath = () => {
  return process.env.EZ4_PROXY_HOME ? join(getProxyHome(), 'logs') : join(homedir(), '.ez4', 'logs');
};

export const openLogFile = (name: string) => {
  const logsPath = getLogsPath();
  const logFile = join(logsPath, `${name}.log`);

  mkdirSync(logsPath, { recursive: true, mode: 0o700 });

  return { logFile, fd: openSync(logFile, 'a', 0o600) };
};

export const getFreePort = () => {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
};

const startDaemon = (plan: ProxyListenPlan) => {
  const { logFile, fd } = openLogFile('proxy');

  spawn(process.execPath, [getCliPath(), 'proxy'], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, EZ4_PROXY_LISTEN: `${plan.listenPort}`, EZ4_PROXY_BEHIND: plan.mode === 'behind' ? '1' : '' }
  }).unref();

  closeSync(fd);

  return logFile;
};

const waitProxy = async (port: number, timeout: number, message: string) => {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await isOwnProxy(port)) {
      return;
    }

    await setTimeout(100);
  }

  throw new Error(message);
};

const getBehindHelp = (port: number, internalPort: number) =>
  `Port ${port} is used by another server that does not send *.localhost to the ez4 proxy (running on port ${internalPort}). ` +
  `Route it there (see "Behind another proxy" in the ez4 docs) or set EZ4_PROXY_PORT=${internalPort}.`;

export const ensureProxy = async (port: number) => {
  const plan = await planProxyListen(port, systemPortProbe);

  if (plan.mode === 'reuse') {
    return;
  }

  if (plan.mode === 'forwarder') {
    ensureForwarder(plan.listenPort);
  }

  if (!(await isOwnProxy(plan.listenPort))) {
    const logFile = startDaemon(plan);
    await waitProxy(plan.listenPort, 3000, `ez4 proxy did not start, see ${logFile}`);
  }

  // The other server's health check may take a moment to pick the daemon up.
  if (plan.mode === 'behind') {
    await waitProxy(port, FRONT_TIMEOUT, getBehindHelp(port, plan.listenPort));
  }
};
