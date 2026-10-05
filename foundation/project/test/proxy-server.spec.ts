import type { AddressInfo } from 'node:net';

import { after, describe, it } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';
import type { IncomingHttpHeaders, Server, ServerResponse } from 'node:http';

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

const remote = createServer((req, res) => {
  res.writeHead(200, { 'access-control-allow-origin': 'https://deployed.example.com', 'content-type': 'application/json' });
  res.end(JSON.stringify({ method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin ?? null }));
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

const call = (port: number, host: string, method: string, headers: Record<string, string> = {}) => {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ port, host: '127.0.0.1', method, path: '/users/me', headers: { host, ...headers } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
};

after(() => {
  target.close();
  remote.close();
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

  it('assert :: a websocket upgrade to a remote route answers 502 Bad Gateway', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    addRoute({ host: 'ws-remote.wt.localhost', port: 0, pid: process.pid, target: 'https://example.com' }, home);

    const req = request({
      port: proxyPort,
      host: '127.0.0.1',
      headers: { host: 'ws-remote.wt.localhost', connection: 'Upgrade', upgrade: 'websocket' }
    });

    req.end();

    const [response] = await once(req, 'response');

    let body = '';
    for await (const chunk of response) body += chunk;

    equal(response.statusCode, 502);
    equal(body, 'ez4 proxy: remote routes do not carry websockets\n');
  });

  it('assert :: the probe host answers 200 without any route', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    const { status, body } = await get(proxyPort, 'ez4-proxy-probe.localhost');

    equal(status, 200);
    equal(body, 'ez4 proxy: ok\n');
  });
});

describe('proxy remote route', () => {
  it('assert :: a remote route forwards under the target path with its host and no origin', async () => {
    const remotePort = await listen(remote);
    const proxyPort = (proxy.address() as AddressInfo).port;

    addRoute({ host: 'api.app.wt.localhost', port: 0, pid: process.pid, target: `http://127.0.0.1:${remotePort}/base` }, home);

    const { status, body } = await call(proxyPort, 'api.app.wt.localhost', 'GET', { origin: 'http://app.wt.localhost' });

    equal(status, 200);
    deepEqual(JSON.parse(body), { method: 'GET', url: '/base/users/me', host: `127.0.0.1:${remotePort}`, origin: null });
  });

  it('assert :: a localhost origin gets credentialed cors instead of the target one', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    const { headers } = await call(proxyPort, 'api.app.wt.localhost', 'GET', { origin: 'http://app.wt.localhost' });

    equal(headers['access-control-allow-origin'], 'http://app.wt.localhost');
    equal(headers['access-control-allow-credentials'], 'true');
  });

  it('assert :: another origin gets no cors at all', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    const { headers } = await call(proxyPort, 'api.app.wt.localhost', 'GET', { origin: 'https://evil.example.com' });

    equal(headers['access-control-allow-origin'], undefined);
  });

  it('assert :: a preflight is answered without reaching the target', async () => {
    const proxyPort = (proxy.address() as AddressInfo).port;

    const { status, headers, body } = await call(proxyPort, 'api.app.wt.localhost', 'OPTIONS', {
      origin: 'http://app.wt.localhost',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type'
    });

    equal(status, 204);
    equal(body, '');
    equal(headers['access-control-allow-methods'], 'POST');
    equal(headers['access-control-allow-headers'], 'authorization,content-type');
  });
});
