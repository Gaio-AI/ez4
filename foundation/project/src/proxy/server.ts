import type { IncomingMessage } from 'node:http';

import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { pipeline } from 'node:stream';

import { findRoute } from './routes';

const getHostname = (req: IncomingMessage) => (req.headers.host ?? '').split(':')[0].toLowerCase();

const getNoRouteMessage = (hostname: string) => `ez4 proxy: no route for ${hostname}\n`;

export const createProxyServer = (home?: string) => {
  const server = createServer((req, res) => {
    const hostname = getHostname(req);
    const route = findRoute(hostname, home);

    if (!route) {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(getNoRouteMessage(hostname));
      return;
    }

    const upstream = request(
      { host: '127.0.0.1', port: route.port, method: req.method, path: req.url, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode!, response.headers);
        pipeline(response, res, () => {});
      }
    );

    upstream.on('error', (error) => {
      if (res.headersSent) {
        res.destroy(error);
      } else {
        res.writeHead(502, { 'content-type': 'text/plain' }).end(`ez4 proxy: ${hostname} unreachable (${error.message})\n`);
      }
    });

    res.on('close', () => {
      if (!res.writableFinished) {
        upstream.destroy();
      }
    });

    req.pipe(upstream);
  });

  server.on('upgrade', (req, socket, head) => {
    const hostname = getHostname(req);
    const route = findRoute(hostname, home);

    if (!route) {
      socket.end(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${getNoRouteMessage(hostname)}`);
      return;
    }

    const upstream = connect(route.port, '127.0.0.1', () => {
      const headers = Object.entries(req.headers).map(([name, value]) => `${name}: ${value}`);

      upstream.write([`${req.method} ${req.url} HTTP/1.1`, ...headers, '', ''].join('\r\n'));
      upstream.write(head);

      socket.pipe(upstream).pipe(socket);
    });

    upstream.on('error', () => socket.destroy());
    upstream.on('close', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });

  return server;
};
