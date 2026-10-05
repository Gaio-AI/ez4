import type { AddressInfo } from 'node:net';

import { after, describe, it } from 'node:test';
import { equal, rejects } from 'node:assert/strict';
import type { Server, ServerResponse } from 'node:http';

import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { createProxyServer } from '../src/proxy/server';
import { addRoute } from '../src/proxy/routes';

const home = mkdtempSync(join(tmpdir(), 'ez4-proxy-'));

let onHangingRequest: (res: ServerResponse) => void;

const hangingResponse = new Promise<ServerResponse>((resolve) => (onHangingRequest = resolve));

const target = createServer((req, res) => {
  if (req.url === '/broken') {
    res.writeHead(200, { 'content-length': '100' });
    res.write('partial');
    setTimeout(() => res.socket?.destroy(), 20);
    return;
  }

  if (req.url === '/hang') {
    onHangingRequest(res);
    return;
  }

  res.end(`${req.method} ${req.url} ${req.headers.host}`);
});
const proxy = createProxyServer(home);

const listen = async (server: Server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
};

const get = (port: number, host: string, path = '/hello?x=1') => {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ port, host: '127.0.0.1', path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
};

after(() => {
  target.close();
  proxy.close();
});

describe('proxy server', () => {
  it('assert :: a request is forwarded by its host', async () => {
    const targetPort = await listen(target);
    const proxyPort = await listen(proxy);

    addRoute({ host: 'console.wt.gaio.localhost', port: targetPort, pid: process.pid }, home);

    const { status, body } = await get(proxyPort, `console.wt.gaio.localhost:${proxyPort}`);

    equal(status, 200);
    equal(body, `GET /hello?x=1 console.wt.gaio.localhost:${proxyPort}`);
  });

  it('assert :: an unknown host answers 502 naming it', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    const { status, body } = await get(proxyPort, 'nothing.wt.gaio.localhost');

    equal(status, 502);
    equal(body, 'ez4 proxy: no route for nothing.wt.gaio.localhost\n');
  });

  it('assert :: an upstream failing mid response drops only that response', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    await rejects(get(proxyPort, 'console.wt.gaio.localhost', '/broken'));

    equal((await get(proxyPort, 'console.wt.gaio.localhost')).status, 200);
  });

  it('assert :: a client abort closes the upstream request', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    const req = request({ port: proxyPort, host: '127.0.0.1', path: '/hang', headers: { host: 'console.wt.gaio.localhost' } });

    req.on('error', () => {});
    req.end();

    const upstreamClosed = once(await hangingResponse, 'close');

    req.destroy();

    await upstreamClosed;
  });

  it('assert :: a websocket upgrade to an unknown host answers 502 naming it', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    const req = request({
      port: proxyPort,
      host: '127.0.0.1',
      headers: { host: 'nothing.wt.gaio.localhost', connection: 'Upgrade', upgrade: 'websocket' }
    });

    req.end();

    const [response] = await once(req, 'response');

    let body = '';
    for await (const chunk of response) body += chunk;

    equal(response.statusCode, 502);
    equal(body, 'ez4 proxy: no route for nothing.wt.gaio.localhost\n');
  });

  it('assert :: the probe host answers 200 without any route', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    const { status, body } = await get(proxyPort, 'ez4-proxy-probe.localhost');

    equal(status, 200);
    equal(body, 'ez4 proxy: ok\n');
  });
});
