import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ProxyRoute = {
  host: string;
  port: number;
  pid: number;
};

export const getProxyHome = () => {
  return process.env.EZ4_PROXY_HOME ?? join(homedir(), '.ez4', 'proxy');
};

const getRoutesPath = (home: string) => join(home, 'routes');

// Hosts come from the untrusted Host header and name files, so only plain hostnames may touch the disk.
export const isRouteHost = (host: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host);

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export const addRoute = (route: ProxyRoute, home = getProxyHome()) => {
  if (!isRouteHost(route.host)) {
    throw new Error(`Invalid route host: ${route.host}`);
  }

  const routesPath = getRoutesPath(home);
  const temporaryFile = join(routesPath, `.${route.host}.${process.pid}`);

  mkdirSync(routesPath, { recursive: true, mode: 0o700 });
  writeFileSync(temporaryFile, `${route.port} ${route.pid}`);
  renameSync(temporaryFile, join(routesPath, route.host));
};

const readRoute = (host: string, home: string): ProxyRoute | undefined => {
  if (!isRouteHost(host)) {
    return undefined;
  }

  let content;

  try {
    content = readFileSync(join(getRoutesPath(home), host), 'utf8');
  } catch {
    return undefined;
  }

  const [port, pid] = content.split(' ').map(Number);

  if (!Number.isInteger(port) || !Number.isInteger(pid)) {
    return undefined;
  }

  return { host, port, pid };
};

export const removeRoute = (host: string, ownerPid?: number, home = getProxyHome()) => {
  const route = readRoute(host, home);

  if (route && (ownerPid === undefined || route.pid === ownerPid)) {
    rmSync(join(getRoutesPath(home), host), { force: true });
  }
};

export const findRoute = (host: string, home = getProxyHome()) => {
  const route = readRoute(host, home);

  if (route && !isAlive(route.pid)) {
    removeRoute(host, route.pid, home);
    return undefined;
  }

  return route;
};

export const listRoutes = (home = getProxyHome()) => {
  let hosts: string[];

  try {
    hosts = readdirSync(getRoutesPath(home)).filter((name) => !name.startsWith('.'));
  } catch {
    return [];
  }

  return hosts.map((host) => findRoute(host, home)).filter((route) => route !== undefined);
};
