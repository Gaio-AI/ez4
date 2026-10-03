import type { AddressInfo } from 'node:net';

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { connect, createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { join } from 'node:path';

import { ensureForwarder, planProxyListen, systemPortProbe } from './port';
import { getProxyHome } from './routes';

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

export const isListening = (port: number) => {
  return new Promise<boolean>((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => resolve(!!socket.end()));
    socket.once('error', () => resolve(false));
  });
};

const startDaemon = (listenPort: number) => {
  const { logFile, fd } = openLogFile('proxy');

  spawn(process.execPath, [getCliPath(), 'proxy'], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, EZ4_PROXY_LISTEN: `${listenPort}` }
  }).unref();

  closeSync(fd);

  return logFile;
};

const waitListening = async (port: number, timeout: number, logFile: string) => {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await isListening(port)) {
      return;
    }

    await setTimeout(50);
  }

  throw new Error(`ez4 proxy did not start, see ${logFile}`);
};

export const ensureProxy = async (port: number) => {
  const plan = await planProxyListen(port, systemPortProbe);

  if (plan.forwarder) {
    ensureForwarder(plan.listenPort);
  }

  if (!(await isListening(plan.listenPort))) {
    const logFile = startDaemon(plan.listenPort);
    await waitListening(plan.listenPort, 3000, logFile);
  }
};
