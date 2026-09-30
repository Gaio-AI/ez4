import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createServer } from 'node:http';

export type ReceivedRequest = {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
};

export type OriginServer = Awaited<ReturnType<typeof startOriginServer>>;

/**
 * Start a regular origin on a random local port, recording every request it receives.
 *
 * - `.../missing` answers 404.
 * - `.../moved` answers a 302 redirect.
 * - `.../error.html` answers an HTML error page.
 * - Anything else answers 200 with the method and URL it got.
 */
export const startOriginServer = async () => {
  const requests: ReceivedRequest[] = [];

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    request.on('end', () => {
      const method = request.method ?? 'GET';
      const url = request.url ?? '/';

      requests.push({
        body: Buffer.concat(chunks).toString(),
        headers: request.headers,
        method,
        url
      });

      const { pathname } = new URL(url, 'http://origin');

      if (pathname.endsWith('/missing')) {
        response.writeHead(404, { ['content-type']: 'text/plain' });
        response.end('origin missing');
        return;
      }

      if (pathname.endsWith('/moved')) {
        response.writeHead(302, { location: 'https://elsewhere.example/target' });
        response.end();
        return;
      }

      if (pathname.endsWith('/error.html')) {
        response.writeHead(200, { ['content-type']: 'text/html' });
        response.end('<p>origin error page</p>');
        return;
      }

      response.writeHead(200, {
        ['content-type']: 'application/json',
        ['x-origin-server']: 'test'
      });

      response.end(JSON.stringify({ method, url }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const { port } = server.address() as AddressInfo;

  return {
    port,
    requests,
    lastRequest: () => {
      return requests.at(-1);
    },
    close: () => {
      server.closeAllConnections();

      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
};
