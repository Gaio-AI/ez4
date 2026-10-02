import type { InputOptions } from '../options';

import { Logger } from '@ez4/logger';

import { spawn } from 'node:child_process';

import { canBindPort, hasDocker, planProxyListen, setupUnprivilegedPort } from '../../proxy/port';
import { ensureProxy, getCliPath, getFreePort, openLogFile } from '../../proxy/daemon';
import { addRoute, findRoute, listRoutes, removeRoute } from '../../proxy/routes';
import { createProxyServer } from '../../proxy/server';
import { getProxyPort } from '../../utils/project';

export const toRouteHost = (name: string) => {
  const hostname = name.split(':')[0];
  return hostname.endsWith('.localhost') ? hostname : `${hostname}.localhost`;
};

const getRouteUrl = (host: string) => {
  const port = getProxyPort();
  return port === 80 ? `http://${host}` : `http://${host}:${port}`;
};

export const proxyCommand = async (input: InputOptions) => {
  const [action, name] = input.positionals ?? [];

  switch (action) {
    case undefined:
      return serveProxy();
    case 'run':
      return input.detach ? runDetached(getRouteName(name), input.arguments ?? []) : runAttached(getRouteName(name), input.arguments ?? []);
    case 'ls':
      return listProxyRoutes();
    case 'stop':
      return stopProxyRoute(getRouteName(name));
    case 'setup':
      process.exit(setupUnprivilegedPort());
  }

  throw new Error(`Unknown proxy action: ${action}. Use run, ls, stop or setup.`);
};

const getRouteName = (name: string | undefined) => {
  if (!name) {
    throw new Error('Missing route name, e.g. `ez4 proxy run console.wt -- npm run serve`.');
  }

  return name;
};

const serveProxy = async () => {
  const port =
    Number(process.env.EZ4_PROXY_LISTEN) || (await planProxyListen(getProxyPort(), { canBind: canBindPort, hasDocker })).listenPort;

  createProxyServer().listen({ port, host: '::', ipv6Only: false }, () => {
    Logger.log(`🔀 ez4 proxy listening on port ${port}`);
  });
};

const runAttached = async (name: string, command: string[]) => {
  const host = toRouteHost(name);

  await ensureProxy(getProxyPort());

  const port = await getFreePort();

  addRoute({ host, port, pid: process.pid });

  // A process group of its own lets signals reach the whole chain (npm → sh → node).
  const child = spawn(command[0], command.slice(1), {
    stdio: 'inherit',
    detached: true,
    env: { ...process.env, PORT: `${port}`, HOST: '127.0.0.1', EZ4_PROXY_ROUTE: host }
  });

  const forward = (signal: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, signal);
    } catch {}
  };

  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);

  child.on('error', (error) => {
    removeRoute(host);
    Logger.error(error.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    removeRoute(host);
    process.exit(code ?? 1);
  });
};

const runDetached = (name: string, command: string[]) => {
  const host = toRouteHost(name);
  const { logFile, fd } = openLogFile(host);

  spawn(process.execPath, [getCliPath(), 'proxy', 'run', name, '--', ...command], {
    detached: true,
    stdio: ['ignore', fd, fd]
  }).unref();

  Logger.log(getRouteUrl(host));
  Logger.log(`Logs: ${logFile}`);
};

const listProxyRoutes = () => {
  for (const { host, port, pid } of listRoutes()) {
    Logger.log(`${host}  ${getRouteUrl(host)}  port ${port}  pid ${pid}`);
  }
};

const stopProxyRoute = (name: string) => {
  const host = toRouteHost(name);
  const route = findRoute(host);

  if (!route) {
    throw new Error(`No running route for ${host}.`);
  }

  process.kill(route.pid, 'SIGTERM');
  removeRoute(host);
};
