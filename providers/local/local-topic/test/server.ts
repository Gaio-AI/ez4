import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createServer } from 'node:http';

export type ReceivedRequest = {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
  time: number;
};

export type TestServer = {
  host: string;
  requests: ReceivedRequest[];
  setAvailable: (available: boolean) => void;
  close: () => Promise<void>;
};

// Stands in for another emulator, it records every request and answers with an error while unavailable.
export const startTestServer = async (): Promise<TestServer> => {
  const requests: ReceivedRequest[] = [];

  let isAvailable = true;

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk) => chunks.push(chunk));

    request.on('end', () => {
      requests.push({
        path: request.url ?? '/',
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
        time: Date.now()
      });

      if (isAvailable) {
        response.writeHead(204).end();
      } else {
        response.writeHead(503, { ['content-type']: 'application/json' }).end(JSON.stringify({ message: 'Service unavailable.' }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;

  return {
    host: `127.0.0.1:${port}`,
    requests,
    setAvailable: (available) => {
      isAvailable = available;
    },
    close: () => {
      server.closeAllConnections();

      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
};
