import type { IncomingMessage } from 'node:http';

import { createServer, request } from 'node:http';
import { connect } from 'node:net';

import { findRoute } from './routes';

const getHostname = (req: IncomingMessage) => (req.headers.host ?? '').split(':')[0].toLowerCase();

export const createProxyServer = (home?: string) => {
  const server = createServer((req, res) => {
    const hostname = getHostname(req);
    const route = findRoute(hostname, home);

    if (!route) {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(`ez4 proxy: no route for ${hostname}\n`);
      return;
    }

    const upstream = request(
      { host: '127.0.0.1', port: route.port, method: req.method, path: req.url, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
      }
    );

    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(`ez4 proxy: ${hostname} unreachable (${error.message})\n`);
    });

    req.pipe(upstream);
  });

  server.on('upgrade', (req, socket, head) => {
    const route = findRoute(getHostname(req), home);

    if (!route) {
      socket.destroy();
      return;
    }

    const upstream = connect(route.port, '127.0.0.1', () => {
      const headers = Object.entries(req.headers).map(([name, value]) => `${name}: ${value}`);

      upstream.write([`${req.method} ${req.url} HTTP/1.1`, ...headers, '', ''].join('\r\n'));
      upstream.write(head);

      socket.pipe(upstream).pipe(socket);
    });

    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return server;
};
