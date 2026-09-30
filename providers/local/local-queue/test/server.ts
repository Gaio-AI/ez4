import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createServer } from 'node:http';

export type ReceivedRequest = {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};

export type TestServer = {
  host: string;
  requests: ReceivedRequest[];
  setStatus: (status: number) => void;
  close: () => Promise<void>;
};

// Stands in for the emulator of another project: it records every request and answers with the given status.
export const startTestServer = async (): Promise<TestServer> => {
  const requests: ReceivedRequest[] = [];

  let currentStatus = 201;

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk) => chunks.push(chunk));

    request.on('end', () => {
      requests.push({
        path: request.url ?? '/',
        headers: request.headers,
        body: Buffer.concat(chunks).toString()
      });

      if (currentStatus < 400) {
        response.writeHead(currentStatus).end();
        return;
      }

      response
        .writeHead(currentStatus, { ['content-type']: 'application/json' })
        .end(JSON.stringify({ message: `Status ${currentStatus}.` }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;

  return {
    host: `127.0.0.1:${port}`,
    requests,
    setStatus: (status) => {
      currentStatus = status;
    },
    close: () => {
      server.closeAllConnections();

      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
};
