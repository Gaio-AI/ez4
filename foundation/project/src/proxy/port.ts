import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';

import { PROBE_HOST } from './server';

export const PROXY_INTERNAL_PORT = 1355;
export const FORWARDER_NAME = 'ez4-proxy-80';

const INTERNAL_PORT_COUNT = 5;

export type ProxyListenPlan = {
  listenPort: number;
  forwarder: boolean;
};

export type BindResult = 'ok' | 'EACCES' | 'EADDRINUSE';

export type ProxyPortProbe = {
  platform: NodeJS.Platform;
  canBind(port: number): Promise<BindResult>;
  hasDocker(): boolean;
  isForwarderRunning(): boolean;
  isOwnProxy(port: number): Promise<boolean>;
};

const PORT_80_HELP = 'Port 80 needs permission. Run `ez4 proxy setup` once (sudo), install Docker, or set EZ4_PROXY_PORT=1355.';

const PORT_80_ROOT_ONLY = 'Port 80 needs root on this OS for a loopback-only proxy. Set EZ4_PROXY_PORT=1355 (URLs will carry :1355).';

const PORT_80_TAKEN = 'Port 80 is used by another server. Stop it or set EZ4_PROXY_PORT=1355.';

export const getInternalPorts = (env = process.env) => {
  const base = Number(env.EZ4_PROXY_INTERNAL_PORT) || 1355;

  return Array.from({ length: INTERNAL_PORT_COUNT }, (_, offset) => base + offset);
};

export const findInternalPort = async (probe: Pick<ProxyPortProbe, 'canBind' | 'isOwnProxy'>, ports = getInternalPorts()) => {
  for (const port of ports) {
    if (await probe.isOwnProxy(port)) {
      return port;
    }
  }

  for (const port of ports) {
    if ((await probe.canBind(port)) === 'ok') {
      return port;
    }
  }

  throw new Error(
    `ez4 proxy: ports ${ports[0]}-${ports[ports.length - 1]} are all used by other servers. Free one or set EZ4_PROXY_INTERNAL_PORT.`
  );
};

// Binding 80 is tried before Docker: Linux with the sysctl or capability needs no container.
// Elsewhere the loopback bind needs root (macOS only frees 80 on the wildcard address) and Docker Desktop's
// host network does not reach host loopback, so no forwarder can help.
export const planProxyListen = async (port: number, probe: ProxyPortProbe): Promise<ProxyListenPlan> => {
  if (port !== 80) {
    return { listenPort: port, forwarder: false };
  }

  const bind = await probe.canBind(80);

  if (bind === 'ok') {
    return { listenPort: 80, forwarder: false };
  }

  if (bind === 'EADDRINUSE') {
    if (probe.isForwarderRunning()) {
      return { listenPort: PROXY_INTERNAL_PORT, forwarder: true };
    }

    if (await probe.isOwnProxy(80)) {
      return { listenPort: 80, forwarder: false };
    }

    throw new Error(PORT_80_TAKEN);
  }

  if (probe.platform !== 'linux') {
    throw new Error(PORT_80_ROOT_ONLY);
  }

  if (probe.hasDocker()) {
    return { listenPort: PROXY_INTERNAL_PORT, forwarder: true };
  }

  throw new Error(PORT_80_HELP);
};

const getSocatCommand = (listen: string, internalPort: number) => `socat ${listen},fork,reuseaddr TCP4:127.0.0.1:${internalPort}`;

export const getForwarderArgs = (internalPort: number) => [
  'run',
  '-d',
  '--restart',
  'unless-stopped',
  '--name',
  FORWARDER_NAME,
  '--network',
  'host',
  '--entrypoint',
  'sh',
  'alpine/socat',
  '-c',
  `${getSocatCommand('TCP4-LISTEN:80,bind=127.0.0.1', internalPort)} & ` +
    `${getSocatCommand('TCP6-LISTEN:80,bind=[::1],ipv6only=1', internalPort)} & wait`
];

export const canBindPort = (port: number) => {
  return new Promise<BindResult>((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EADDRINUSE' ? 'EADDRINUSE' : 'EACCES'));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve('ok')));
  });
};

export const isOwnProxy = (port: number) => {
  return new Promise<boolean>((resolve) => {
    const probe = request({ host: '127.0.0.1', port, headers: { host: PROBE_HOST }, timeout: 1000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve(body.startsWith('ez4 proxy:')));
      response.on('error', () => resolve(false));
    });

    probe.on('timeout', () => probe.destroy());
    probe.on('error', () => resolve(false));
    probe.end();
  });
};

export const hasDocker = () => {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
};

const getForwarderState = () => {
  return spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', FORWARDER_NAME], { encoding: 'utf8' });
};

export const isForwarderRunning = () => getForwarderState().stdout?.trim() === 'true';

export const systemPortProbe: ProxyPortProbe = {
  platform: process.platform,
  canBind: canBindPort,
  hasDocker,
  isForwarderRunning,
  isOwnProxy
};

export const ensureForwarder = (internalPort: number) => {
  const state = getForwarderState();

  if (state.stdout?.trim() === 'true') {
    return;
  }

  const args = state.status === 0 ? ['start', FORWARDER_NAME] : getForwarderArgs(internalPort);
  const result = spawnSync('docker', args, { stdio: 'inherit' });

  // Another ez4 process may have created the container between the inspect and the run.
  if (result.status !== 0 && !isForwarderRunning()) {
    throw new Error(`Unable to start ${FORWARDER_NAME}. ${PORT_80_HELP}`);
  }
};

export const setupUnprivilegedPort = () => {
  const command = "echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/50-ez4-proxy.conf && sysctl --system >/dev/null";

  return spawnSync('sudo', ['sh', '-c', command], { stdio: 'inherit' }).status ?? 1;
};
