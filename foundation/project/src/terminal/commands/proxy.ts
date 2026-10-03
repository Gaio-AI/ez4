import type { InputOptions } from '../options';

import { Logger } from '@ez4/logger';

import { spawn } from 'node:child_process';
import { closeSync } from 'node:fs';

import { ensureForwarder, planProxyListen, setupUnprivilegedPort, systemPortProbe } from '../../proxy/port';
import { ensureProxy, getCliPath, getFreePort, openLogFile } from '../../proxy/daemon';
import { addRoute, findRoute, isRouteHost, listRoutes, removeRoute } from '../../proxy/routes';
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
      return input.detach
        ? runDetached(getRouteHost(name), getRunCommand(name, input))
        : runAttached(getRouteHost(name), getRunCommand(name, input));
    case 'ls':
      return listProxyRoutes();
    case 'stop':
      return stopProxyRoute(getRouteHost(name));
    case 'setup':
      return setupProxyPort();
  }

  throw new Error(`Unknown proxy action: ${action}. Use run, ls, stop or setup.`);
};

const getRouteHost = (name: string | undefined) => {
  if (!name) {
    throw new Error('Missing route name, e.g. `ez4 proxy run console.wt -- npm run serve`.');
  }

  const host = toRouteHost(name);

  if (!isRouteHost(host)) {
    throw new Error(`Invalid route name: ${name}. Use letters, digits, dashes and dots.`);
  }

  return host;
};

const getRunCommand = (name: string, input: InputOptions) => {
  if (!input.arguments?.length) {
    throw new Error(`Missing command, e.g. \`ez4 proxy run ${name} -- npm run serve\`.`);
  }

  return input.arguments;
};

const assertRouteFree = (host: string) => {
  const route = findRoute(host);

  if (route && route.pid !== process.pid) {
    throw new Error(`${host} is already running (pid ${route.pid}). Stop it with \`ez4 proxy stop ${host}\`.`);
  }
};

const setupProxyPort = () => {
  if (process.platform !== 'linux') {
    Logger.log('ez4 proxy setup is not available on this OS; use EZ4_PROXY_PORT=1355.');
    return;
  }

  process.exit(setupUnprivilegedPort());
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

const runAttached = async (host: string, command: string[]) => {
  assertRouteFree(host);

  await ensureProxy(getProxyPort());

  const port = await getFreePort();

  addRoute({ host, port, pid: process.pid });

  // The child stays in the foreground process group so it keeps the terminal (no SIGTTIN on stdin reads).
  const child = spawn(command[0], command.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, PORT: `${port}`, HOST: '127.0.0.1', EZ4_PROXY_ROUTE: host, EZ4_PROXY_GROUP_LEADER: undefined }
  });

  const forward = process.env.EZ4_PROXY_GROUP_LEADER ? forwardToGroup : (signal: NodeJS.Signals) => child.kill(signal);

  // A terminal already delivers Ctrl+C to the whole foreground group, child included.
  process.on('SIGINT', process.stdin.isTTY ? () => {} : forward);
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

let isForwardingToGroup = false;

// The background wrapper leads its own process group, so the signal reaches shells that do not forward it.
// It is delivered back to the wrapper too, which then keeps running until the child exits.
const forwardToGroup = (signal: NodeJS.Signals) => {
  if (!isForwardingToGroup) {
    isForwardingToGroup = true;
    process.kill(-process.pid, signal);
  }
};

const runDetached = async (host: string, command: string[]) => {
  assertRouteFree(host);

  await ensureProxy(getProxyPort());

  const { logFile, fd } = openLogFile(host);

  spawn(process.execPath, [getCliPath(), 'proxy', 'run', host, '--', ...command], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, EZ4_PROXY_GROUP_LEADER: '1' }
  }).unref();

  closeSync(fd);

  Logger.log(getRouteUrl(host));
  Logger.log(`Logs: ${logFile}`);
};

const listProxyRoutes = () => {
  for (const { host, port, pid } of listRoutes()) {
    Logger.log(`${host}  ${getRouteUrl(host)}  port ${port}  pid ${pid}`);
  }
};

const stopProxyRoute = (host: string) => {
  const route = findRoute(host);

  if (!route) {
    throw new Error(`No running route for ${host}.`);
  }

  process.kill(route.pid, 'SIGTERM');
  removeRoute(host, route.pid);
};
