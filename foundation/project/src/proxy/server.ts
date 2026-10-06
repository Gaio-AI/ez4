import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';

import { createServer, request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { pipeline } from 'node:stream';

import { findRoute } from './routes';

export const PROBE_HOST = 'ez4-proxy-probe.localhost';

const getHostname = (req: IncomingMessage) => (req.headers.host ?? '').split(':')[0].toLowerCase();

const getNoRouteMessage = (hostname: string) => `ez4 proxy: no route for ${hostname}\n`;

const isLocalOrigin = (origin: string | undefined) => {
  try {
    const { hostname } = new URL(origin ?? '');
    return hostname === 'localhost' || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
};

// Only pages served on localhost may read a remote route, with credentials, whatever the target allows.
const getRemoteCors = (req: IncomingMessage): Record<string, string> => {
  const { origin } = req.headers;

  if (!isLocalOrigin(origin)) {
    return {};
  }

  const headers: Record<string, string> = {
    'access-control-allow-origin': origin!,
    'access-control-allow-credentials': 'true',
    vary: 'Origin'
  };
  const method = req.headers['access-control-request-method'];

  if (req.method === 'OPTIONS' && method) {
    headers['access-control-allow-methods'] = method;
    headers['access-control-allow-headers'] = req.headers['access-control-request-headers'] ?? '';
    headers['access-control-max-age'] = '7200';
  }

  return headers;
};

const pipeUpstream = (req: IncomingMessage, res: ServerResponse, hostname: string, upstream: ClientRequest) => {
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
};

const forwardRemote = (req: IncomingMessage, res: ServerResponse, hostname: string, target: URL) => {
  const cors = getRemoteCors(req);

  if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
    res.writeHead(204, cors).end();
    return;
  }

  const { origin: _origin, referer: _referer, host: _host, ...headers } = req.headers;
  const send = target.protocol === 'https:' ? httpsRequest : request;
  const path = `${target.pathname.replace(/\/$/, '')}${req.url}`;

  const upstream = send(
    { host: target.hostname, port: target.port || undefined, method: req.method, path, headers: { ...headers, host: target.host } },
    (response) => {
      const responseHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !name.startsWith('access-control-')));

      res.writeHead(response.statusCode!, { ...responseHeaders, ...cors });
      pipeline(response, res, () => {});
    }
  );

  pipeUpstream(req, res, hostname, upstream);
};

export const createProxyServer = (home?: string) => {
  const server = createServer((req, res) => {
    const hostname = getHostname(req);

    if (hostname === PROBE_HOST) {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ez4 proxy: ok\n');
      return;
    }

    const route = findRoute(hostname, home);

    if (!route) {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(getNoRouteMessage(hostname));
      return;
    }

    if (route.target) {
      forwardRemote(req, res, hostname, new URL(route.target));
      return;
    }

    const upstream = request(
      { host: '127.0.0.1', port: route.port, method: req.method, path: req.url, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode!, response.headers);
        pipeline(response, res, () => {});
      }
    );

    pipeUpstream(req, res, hostname, upstream);
  });

  server.on('upgrade', (req, socket, head) => {
    const hostname = getHostname(req);
    const route = findRoute(hostname, home);

    if (!route) {
      socket.end(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${getNoRouteMessage(hostname)}`);
      return;
    }

    if (route.target) {
      socket.end(
        'HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nez4 proxy: remote routes do not carry websockets\n'
      );
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
