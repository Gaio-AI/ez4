import type { AddressInfo } from 'node:net';
import type { ServiceEmulators } from '../src/emulator/service';
import type { EmulatorRequestEvent } from '../src/emulator/types';
import type { ServeOptions } from '../src/types/options';

import { after, before, beforeEach, describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { createServer } from 'node:http';

import { Logger } from '@ez4/logger';

import { requestHandler } from '../src/serve/request';

const ORIGIN = 'https://app.test';

const handledRequests: EmulatorRequestEvent[] = [];

// Answers as a gateway that sets its own CORS headers, which a gateway with declared CORS replaces.
const handleGatewayRequest = (request: EmulatorRequestEvent) => {
  handledRequests.push(request);

  if (request.path === '/fail') {
    throw new Error('Gateway failure.');
  }

  return {
    status: request.method === 'OPTIONS' ? 204 : 200,
    headers: {
      ['access-control-allow-origin']: '*',
      ['x-handled']: 'yes'
    }
  };
};

const emulators: ServiceEmulators = {
  gateway: {
    type: 'Gateway',
    name: 'Gateway',
    identifier: 'gateway',
    requestHandler: handleGatewayRequest,
    corsHandler: (request) => {
      const headers: Record<string, string> = {};

      if (request.headers.origin === ORIGIN) {
        headers['access-control-allow-origin'] = ORIGIN;
        headers['access-control-expose-headers'] = 'x-trace-id';
      }

      return headers;
    }
  },
  plain: {
    type: 'Gateway',
    name: 'Plain',
    identifier: 'plain',
    aliases: ['plain-api-name'],
    requestHandler: handleGatewayRequest,
    corsHandler: () => {
      return undefined;
    }
  },
  queue: {
    type: 'Queue',
    name: 'Queue',
    identifier: 'queue',
    requestHandler: () => {
      throw new Error('Unsupported queue request.');
    }
  },
  import: {
    type: 'Gateway',
    name: 'Import',
    identifier: 'import'
  },
  topic: {
    type: 'Topic',
    name: 'Topic',
    identifier: 'topic',
    requestHandler: () => {
      return {
        status: 201
      };
    }
  }
};

const getCorsHeaders = (response: Response) => {
  return Object.fromEntries([...response.headers.entries()].filter(([name]) => name.startsWith('access-control-')));
};

describe('project serve requests', () => {
  const server = createServer();

  let serviceHost = '';

  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    serviceHost = `127.0.0.1:${(server.address() as AddressInfo).port}`;

    const options = {
      projectName: 'serve',
      serviceHost
    } as ServeOptions;

    server.on('request', (request, stream) => {
      return requestHandler(request, stream, emulators, options);
    });
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  beforeEach(() => {
    handledRequests.splice(0);
  });

  const sendRequest = (path: string, init?: RequestInit) => {
    return fetch(`http://${serviceHost}${path}`, init);
  };

  it('assert :: emulator answers under its alias', async () => {
    const response = await sendRequest('/plain-api-name/items?page=2');

    equal(response.status, 200);

    deepEqual(
      handledRequests.map(({ method, path, query }) => [method, path, query]),
      [['GET', '/items', { page: '2' }]]
    );
  });

  it('assert :: emulator not found answers with cors', async () => {
    const response = await sendRequest('/unknown/path', { headers: { origin: ORIGIN } });

    equal(response.status, 404);

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-allow-credentials']: 'true'
    });
  });

  it('assert :: emulator without requests answers with cors', async () => {
    const response = await sendRequest('/import/path', { headers: { origin: ORIGIN } });

    equal(response.status, 422);

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-allow-credentials']: 'true'
    });
  });

  it('assert :: emulator failure answers with cors', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    const response = await sendRequest('/queue', { method: 'POST', headers: { origin: ORIGIN } });

    equal(response.status, 500);

    deepEqual(await response.json(), {
      type: 'error',
      message: 'Error: Unsupported queue request.'
    });

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-allow-credentials']: 'true'
    });
  });

  it('assert :: error without origin answers without cors', async () => {
    const response = await sendRequest('/unknown/path');

    equal(response.status, 404);

    deepEqual(getCorsHeaders(response), {});
  });

  it('assert :: emulator response allows any origin', async () => {
    const response = await sendRequest('/topic', { method: 'POST', headers: { origin: ORIGIN } });

    equal(response.status, 201);

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-allow-credentials']: 'true'
    });
  });

  it('assert :: preflight allows any origin, method and headers', async () => {
    const response = await sendRequest('/topic', {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        ['access-control-request-method']: 'PATCH',
        ['access-control-request-headers']: 'x-anything'
      }
    });

    equal(response.status, 204);

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-allow-credentials']: 'true',
      ['access-control-allow-methods']: 'PATCH',
      ['access-control-allow-headers']: 'x-anything'
    });
  });

  it('assert :: preflight goes to the emulator with its own cors', async () => {
    const response = await sendRequest('/gateway/items', {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        ['access-control-request-method']: 'PATCH',
        ['access-control-request-headers']: 'x-anything'
      }
    });

    equal(response.status, 204);
    equal(response.headers.get('x-handled'), 'yes');

    deepEqual(
      handledRequests.map(({ method, path }) => [method, path]),
      [['OPTIONS', '/items']]
    );

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-expose-headers']: 'x-trace-id'
    });
  });

  it('assert :: emulator cors replaces the response cors', async () => {
    const response = await sendRequest('/gateway/items', { headers: { origin: ORIGIN } });

    equal(response.status, 200);

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-expose-headers']: 'x-trace-id'
    });
  });

  it('assert :: emulator cors refuses an origin', async () => {
    const response = await sendRequest('/gateway/items', { headers: { origin: 'https://other.test' } });

    equal(response.status, 200);

    deepEqual(getCorsHeaders(response), {});
  });

  it('assert :: emulator cors applies to its failures', async (t) => {
    t.mock.method(Logger, 'error', () => {});

    const response = await sendRequest('/gateway/fail', { headers: { origin: ORIGIN } });

    equal(response.status, 500);

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: ORIGIN,
      ['access-control-expose-headers']: 'x-trace-id'
    });
  });

  it('assert :: emulator without cors keeps the response as it is', async () => {
    const response = await sendRequest('/plain/items', { headers: { origin: ORIGIN } });

    equal(response.status, 200);

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: '*'
    });
  });

  it('assert :: emulator without cors gets the preflight', async () => {
    const response = await sendRequest('/plain/items', {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        ['access-control-request-method']: 'PATCH'
      }
    });

    equal(response.status, 204);

    deepEqual(
      handledRequests.map(({ method, path }) => [method, path]),
      [['OPTIONS', '/items']]
    );

    deepEqual(getCorsHeaders(response), {
      ['access-control-allow-origin']: '*'
    });
  });
});
