import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createServer, isIP } from 'node:net';

import { PROBE_HOST } from './server';

export const FORWARDER_NAME = 'ez4-proxy-80';

const INTERNAL_PORT_COUNT = 5;
const FORWARDER_PORT_LABEL = 'ez4.port';

export type ProxyListenMode = 'direct' | 'reuse' | 'forwarder' | 'behind';

export type ProxyListenPlan = {
  listenPort: number;
  mode: ProxyListenMode;
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

const getPrivilegedPortHelp = (port: number) => `Port ${port} needs root. Set EZ4_PROXY_PORT to a port above 1023.`;

// Binding is tried before anything else: Linux with the sysctl or capability needs no container.
// A port held by another server leaves the URLs on it and puts ez4 behind it (see ensureProxy).
export const planProxyListen = async (port: number, probe: ProxyPortProbe): Promise<ProxyListenPlan> => {
  const bind = await probe.canBind(port);

  if (bind === 'ok') {
    return { listenPort: port, mode: 'direct' };
  }

  if (bind === 'EADDRINUSE') {
    if (await probe.isOwnProxy(port)) {
      return { listenPort: port, mode: 'reuse' };
    }

    const listenPort = await findInternalPort(probe);

    return { listenPort, mode: port === 80 && probe.isForwarderRunning() ? 'forwarder' : 'behind' };
  }

  if (port !== 80) {
    throw new Error(getPrivilegedPortHelp(port));
  }

  if (probe.platform !== 'linux') {
    throw new Error(PORT_80_ROOT_ONLY);
  }

  if (probe.hasDocker()) {
    return { listenPort: await findInternalPort(probe), mode: 'forwarder' };
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
  '--label',
  `${FORWARDER_PORT_LABEL}=${internalPort}`,
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
  const result = spawnSync(
    'docker',
    ['inspect', '-f', `{{.State.Running}} {{index .Config.Labels "${FORWARDER_PORT_LABEL}"}}`, FORWARDER_NAME],
    {
      encoding: 'utf8'
    }
  );
  const [running, port] = result.status === 0 ? result.stdout.trim().split(' ') : [];

  return { exists: result.status === 0, running: running === 'true', port: Number(port) };
};

export const isForwarderRunning = () => getForwarderState().running;

export const systemPortProbe: ProxyPortProbe = {
  platform: process.platform,
  canBind: canBindPort,
  hasDocker,
  isForwarderRunning,
  isOwnProxy
};

export const ensureForwarder = (internalPort: number) => {
  const state = getForwarderState();

  if (state.running && state.port === internalPort) {
    return;
  }

  // A forwarder created for another internal port (or before the label) is replaced, not reused.
  if (state.exists && state.port !== internalPort) {
    spawnSync('docker', ['rm', '-f', FORWARDER_NAME], { stdio: 'ignore' });
  }

  const args = state.exists && state.port === internalPort ? ['start', FORWARDER_NAME] : getForwarderArgs(internalPort);
  const result = spawnSync('docker', args, { stdio: 'inherit' });

  // Another ez4 process may have created the container between the inspect and the run.
  if (result.status !== 0 && !isForwarderRunning()) {
    throw new Error(`Unable to start ${FORWARDER_NAME}. ${PORT_80_HELP}`);
  }
};

export const getDockerGateway = () => {
  const result = spawnSync('docker', ['network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8' });
  const gateway = result.status === 0 ? result.stdout.trim() : '';

  return isIP(gateway) === 4 ? gateway : undefined;
};

export const setupUnprivilegedPort = () => {
  const command = "echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/50-ez4-proxy.conf && sysctl --system >/dev/null";

  return spawnSync('sudo', ['sh', '-c', command], { stdio: 'inherit' }).status ?? 1;
};
