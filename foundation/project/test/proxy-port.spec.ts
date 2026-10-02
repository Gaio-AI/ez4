import type { AddressInfo } from 'node:net';
import type { BindResult } from '../src/proxy/port';

import { describe, it } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { canBindPort, getForwarderArgs, isOwnProxy, planProxyListen } from '../src/proxy/port';
import { createProxyServer } from '../src/proxy/server';

const probe = (bind: BindResult, options: { docker?: boolean; forwarder?: boolean; ownProxy?: boolean } = {}) => ({
  canBind: async () => bind,
  hasDocker: () => !!options.docker,
  isForwarderRunning: () => !!options.forwarder,
  isOwnProxy: async () => !!options.ownProxy
});

const listen = async (server: ReturnType<typeof createServer>) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
};

describe('proxy port', () => {
  it('assert :: a port other than 80 is used as is', async () => {
    deepEqual(await planProxyListen(1355, probe('EACCES')), { listenPort: 1355, forwarder: false });
  });

  it('assert :: port 80 is bound directly when allowed', async () => {
    deepEqual(await planProxyListen(80, probe('ok', { docker: true })), { listenPort: 80, forwarder: false });
  });

  it('assert :: port 80 falls back to the docker forwarder', async () => {
    deepEqual(await planProxyListen(80, probe('EACCES', { docker: true })), { listenPort: 1355, forwarder: true });
  });

  it('assert :: port 80 without permission nor docker points to setup', async () => {
    await rejects(planProxyListen(80, probe('EACCES')), /ez4 proxy setup/);
  });

  it('assert :: port 80 held by the running forwarder keeps the forwarder plan', async () => {
    deepEqual(await planProxyListen(80, probe('EADDRINUSE', { docker: true, forwarder: true })), { listenPort: 1355, forwarder: true });
  });

  it('assert :: port 80 held by an ez4 proxy is used directly', async () => {
    deepEqual(await planProxyListen(80, probe('EADDRINUSE', { ownProxy: true })), { listenPort: 80, forwarder: false });
  });

  it('assert :: port 80 held by another server fails', async () => {
    await rejects(planProxyListen(80, probe('EADDRINUSE', { docker: true })), /used by another server/);
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

  it('assert :: the forwarder repeats port 80 on ipv4 and ipv6 loopback only', () => {
    deepEqual(getForwarderArgs(1355), [
      'run',
      '-d',
      '--restart',
      'unless-stopped',
      '--name',
      'ez4-proxy-80',
      '--network',
      'host',
      '--entrypoint',
      'sh',
      'alpine/socat',
      '-c',
      'socat TCP4-LISTEN:80,bind=127.0.0.1,fork,reuseaddr TCP4:127.0.0.1:1355 & ' +
        'socat TCP6-LISTEN:80,bind=[::1],ipv6only=1,fork,reuseaddr TCP4:127.0.0.1:1355 & wait'
    ]);
  });
});
