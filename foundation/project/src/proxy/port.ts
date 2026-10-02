import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

export const PROXY_INTERNAL_PORT = 1355;
export const FORWARDER_NAME = 'ez4-proxy-80';

export type ProxyListenPlan = {
  listenPort: number;
  forwarder: boolean;
};

export type ProxyPortProbe = {
  canBind(port: number): Promise<boolean>;
  hasDocker(): boolean;
};

const PORT_80_HELP = 'Port 80 needs permission. Run `ez4 proxy setup` once (sudo), install Docker, or set EZ4_PROXY_PORT=1355.';

// Binding 80 is tried before Docker: macOS, Windows and Linux with the sysctl or capability need no container.
export const planProxyListen = async (port: number, probe: ProxyPortProbe): Promise<ProxyListenPlan> => {
  if (port !== 80 || (await probe.canBind(80))) {
    return { listenPort: port, forwarder: false };
  }

  if (probe.hasDocker()) {
    return { listenPort: PROXY_INTERNAL_PORT, forwarder: true };
  }

  throw new Error(PORT_80_HELP);
};

export const getForwarderArgs = (internalPort: number) => [
  'run',
  '-d',
  '--restart',
  'unless-stopped',
  '--name',
  FORWARDER_NAME,
  '--network',
  'host',
  'alpine/socat',
  'TCP6-LISTEN:80,fork,reuseaddr,ipv6only=0',
  `TCP4:127.0.0.1:${internalPort}`
];

export const canBindPort = (port: number) => {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '::', ipv6Only: false }, () => server.close(() => resolve(true)));
  });
};

export const hasDocker = () => {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
};

export const ensureForwarder = (internalPort: number) => {
  const state = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', FORWARDER_NAME], { encoding: 'utf8' });

  if (state.stdout.trim() === 'true') {
    return;
  }

  const args = state.status === 0 ? ['start', FORWARDER_NAME] : getForwarderArgs(internalPort);
  const result = spawnSync('docker', args, { stdio: 'inherit' });

  if (result.status !== 0) {
    throw new Error(`Unable to start ${FORWARDER_NAME}. ${PORT_80_HELP}`);
  }
};

export const setupUnprivilegedPort = () => {
  const command = "echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/50-ez4-proxy.conf && sysctl --system >/dev/null";

  return spawnSync('sudo', ['sh', '-c', command], { stdio: 'inherit' }).status ?? 1;
};
