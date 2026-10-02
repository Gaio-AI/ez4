import type { InputOptions } from '../options';

import { Logger } from '@ez4/logger';

import { spawn } from 'node:child_process';

import { ensureForwarder, planProxyListen, setupUnprivilegedPort, systemPortProbe } from '../../proxy/port';
import { ensureProxy, getCliPath, getFreePort, openLogFile } from '../../proxy/daemon';
import { addRoute, findRoute, listRoutes, removeRoute } from '../../proxy/routes';
import { createProxyServer } from '../../proxy/server';
import { getProxyPort } from '../../utils/project';

export const toRouteHost = (name: string) => {
  const hostname = name.split(':')[0].toLowerCase();
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

const getListenPort = async () => {
  const daemonPort = Number(process.env.EZ4_PROXY_LISTEN);

  if (daemonPort) {
    return daemonPort;
  }

  const plan = await planProxyListen(getProxyPort(), systemPortProbe);

  if (plan.forwarder) {
    ensureForwarder(plan.listenPort);
  }

  return plan.listenPort;
};

const serveProxy = async () => {
  const port = await getListenPort();

  // IPv6 is bound only after IPv4 is won, so two racing daemons never end up holding half each.
  listenLoopback(port, '127.0.0.1', () => {
    listenLoopback(port, '::1', () => Logger.log(`🔀 ez4 proxy listening on 127.0.0.1 and ::1 port ${port}`));
  });
};

const listenLoopback = (port: number, host: string, onListening: () => void) => {
  const server = createProxyServer();

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (host === '::1') {
      Logger.warn(`ez4 proxy listening on 127.0.0.1 only (${error.message})`);
      return;
    }

    if (error.code === 'EADDRINUSE') {
      Logger.log(`ez4 proxy is already listening on port ${port}`);
      process.exit(0);
    }

    Logger.error(error.message);
    process.exit(1);
  });

  server.listen(port, host, onListening);
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
    removeRoute(host, process.pid);
    Logger.error(error.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    removeRoute(host, process.pid);
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
  removeRoute(host, route.pid);
};
