import type { AddressInfo } from 'node:net';
import type { BindResult } from '../src/proxy/port';

import { describe, it } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';
import type { Server } from 'node:http';

import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { canBindPort, findInternalPort, getForwarderArgs, getInternalPorts, isOwnProxy, planProxyListen } from '../src/proxy/port';
import { createProxyServer } from '../src/proxy/server';

// The internal range (1355-1359) is free unless listed in `busy`; any other port answers `bind`.
const isInternal = (port: number) => port >= 1355 && port <= 1359;

const probe = (
  bind: BindResult,
  options: { docker?: boolean; forwarder?: boolean; ownProxy?: boolean; busy?: number[]; platform?: NodeJS.Platform } = {}
) => ({
  platform: options.platform ?? 'linux',
  canBind: async (port: number): Promise<BindResult> => (!isInternal(port) ? bind : options.busy?.includes(port) ? 'EADDRINUSE' : 'ok'),
  hasDocker: () => !!options.docker,
  isForwarderRunning: () => !!options.forwarder,
  isOwnProxy: async (port: number) => !isInternal(port) && !!options.ownProxy
});

const listen = async (server: Server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
};

const rangeProbe = (state: Record<number, 'own' | 'other'>) => ({
  canBind: async (port: number): Promise<BindResult> => (state[port] ? 'EADDRINUSE' : 'ok'),
  isOwnProxy: async (port: number) => state[port] === 'own'
});

describe('proxy port', () => {
  it('assert :: a free port is bound directly', async () => {
    deepEqual(await planProxyListen(1300, probe('ok')), { listenPort: 1300, mode: 'direct' });
    deepEqual(await planProxyListen(80, probe('ok', { docker: true })), { listenPort: 80, mode: 'direct' });
  });

  it('assert :: a port held by an ez4 proxy is reused', async () => {
    deepEqual(await planProxyListen(80, probe('EADDRINUSE', { ownProxy: true })), { listenPort: 80, mode: 'reuse' });
  });

  it('assert :: a port held by another server puts ez4 behind it on the first free internal port', async () => {
    deepEqual(await planProxyListen(80, probe('EADDRINUSE', { docker: true, busy: [1355] })), { listenPort: 1356, mode: 'behind' });
    deepEqual(await planProxyListen(1300, probe('EADDRINUSE')), { listenPort: 1355, mode: 'behind' });
  });

  it('assert :: port 80 held by the running forwarder keeps the forwarder', async () => {
    deepEqual(await planProxyListen(80, probe('EADDRINUSE', { docker: true, forwarder: true })), { listenPort: 1355, mode: 'forwarder' });
  });

  it('assert :: port 80 without permission falls back to the docker forwarder', async () => {
    deepEqual(await planProxyListen(80, probe('EACCES', { docker: true, busy: [1355] })), { listenPort: 1356, mode: 'forwarder' });
  });

  it('assert :: port 80 without permission outside linux asks for another port instead of docker', async () => {
    await rejects(
      planProxyListen(80, probe('EACCES', { docker: true, platform: 'darwin' })),
      /EZ4_PROXY_PORT=1355 \(URLs will carry :1355\)/
    );
  });

  it('assert :: port 80 without permission nor docker points to setup', async () => {
    await rejects(planProxyListen(80, probe('EACCES')), /ez4 proxy setup/);
  });

  it('assert :: another privileged port without permission asks for a port above 1023', async () => {
    await rejects(planProxyListen(81, probe('EACCES', { docker: true })), /above 1023/);
  });

  it('assert :: an ez4 proxy is told apart from another server', async () => {
    const proxy = createProxyServer(mkdtempSync(join(tmpdir(), 'ez4-proxy-')));
    const other = createServer((_req, res) => res.end('hello'));

    const [proxyPort, otherPort] = [await listen(proxy), await listen(other)];

    try {
      equal(await isOwnProxy(proxyPort), true);
      equal(await isOwnProxy(otherPort), false);
    } finally {
      proxy.close();
      other.close();
    }
  });

  it('assert :: a loopback port in use is reported as such', async () => {
    const server = createServer();
    const port = await listen(server);

    try {
      equal(await canBindPort(port), 'EADDRINUSE');
    } finally {
      server.close();
    }

    equal(await canBindPort(port), 'ok');
  });

  it('assert :: the forwarder repeats port 80 on loopback to the labelled internal port', () => {
    deepEqual(getForwarderArgs(1356), [
      'run',
      '-d',
      '--restart',
      'unless-stopped',
      '--name',
      'ez4-proxy-80',
      '--label',
      'ez4.port=1356',
      '--network',
      'host',
      '--entrypoint',
      'sh',
      'alpine/socat',
      '-c',
      'socat TCP4-LISTEN:80,bind=127.0.0.1,fork,reuseaddr TCP4:127.0.0.1:1356 & ' +
        'socat TCP6-LISTEN:80,bind=[::1],ipv6only=1,fork,reuseaddr TCP4:127.0.0.1:1356 & wait'
    ]);
  });
});

describe('proxy internal port', () => {
  it('assert :: the range starts at 1355 unless EZ4_PROXY_INTERNAL_PORT moves it', () => {
    deepEqual(getInternalPorts({}), [1355, 1356, 1357, 1358, 1359]);
    deepEqual(getInternalPorts({ EZ4_PROXY_INTERNAL_PORT: '2400' }), [2400, 2401, 2402, 2403, 2404]);
  });

  it('assert :: a running ez4 proxy in the range is reused before a free port', async () => {
    equal(await findInternalPort(rangeProbe({ 1357: 'own' })), 1357);
  });

  it('assert :: a port held by another server is skipped', async () => {
    equal(await findInternalPort(rangeProbe({ 1355: 'other' })), 1356);
  });

  it('assert :: a range held by other servers fails naming it', async () => {
    const state = { 1355: 'other', 1356: 'other', 1357: 'other', 1358: 'other', 1359: 'other' } as const;

    await rejects(findInternalPort(rangeProbe(state)), /ports 1355-1359 are all used by other servers/);
  });

  it('assert :: a server answering 200 to everything is not an ez4 proxy', async () => {
    const other = createServer((_req, res) => res.end('ok'));
    const otherPort = await listen(other);

    try {
      equal(await isOwnProxy(otherPort), false);
    } finally {
      other.close();
    }
  });
});
