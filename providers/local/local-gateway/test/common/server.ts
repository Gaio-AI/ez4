import type { AddressInfo } from 'node:net';

import { createServer } from 'node:http';

export type ReceivedRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export type ServerAnswer = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
};

// A real HTTP server, so requests go through the network stack instead of a `fetch` stub.
export const startServer = async (answer: (request: ReceivedRequest) => ServerAnswer) => {
  const received: ReceivedRequest[] = [];

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    request.on('end', () => {
      const entry = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString()
      };

      received.push(entry);

      const result = answer(entry);

      // Responses of different seconds must still compare equal.
      response.sendDate = false;

      response.writeHead(result.status, result.headers);
      response.end(result.body);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;

  return {
    host: `127.0.0.1:${port}`,
    received,
    close: () => {
      server.closeAllConnections();

      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
};
