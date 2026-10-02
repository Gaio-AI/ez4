import type { AddressInfo } from 'node:net';

import { after, describe, it } from 'node:test';
import { equal } from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { createProxyServer } from '../src/proxy/server';
import { addRoute } from '../src/proxy/routes';

const home = mkdtempSync(join(tmpdir(), 'ez4-proxy-'));

const target = createServer((req, res) => res.end(`${req.method} ${req.url} ${req.headers.host}`));
const proxy = createProxyServer(home);

const listen = async (server: ReturnType<typeof createServer>) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
};

const get = (port: number, host: string) => {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ port, host: '127.0.0.1', path: '/hello?x=1', headers: { host } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body }));
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
});
