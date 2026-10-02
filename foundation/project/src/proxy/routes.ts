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
  const routesPath = getRoutesPath(home);
  const temporaryFile = join(routesPath, `.${route.host}.${process.pid}`);

  mkdirSync(routesPath, { recursive: true });
  writeFileSync(temporaryFile, `${route.port} ${route.pid}`);
  renameSync(temporaryFile, join(routesPath, route.host));
};

export const removeRoute = (host: string, home = getProxyHome()) => {
  rmSync(join(getRoutesPath(home), host), { force: true });
};

export const findRoute = (host: string, home = getProxyHome()): ProxyRoute | undefined => {
  let content;

  try {
    content = readFileSync(join(getRoutesPath(home), host), 'utf8');
  } catch {
    return undefined;
  }

  const [port, pid] = content.split(' ').map(Number);

  if (!isAlive(pid)) {
    removeRoute(host, home);
    return undefined;
  }

  return { host, port, pid };
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
