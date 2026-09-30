import type { EmulateServiceEvent, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { AnyObject } from '@ez4/utils';

import { describe, it } from 'node:test';
import { deepEqual, equal, rejects, throws } from 'node:assert/strict';

import { getServiceName, tryCreateTrigger } from '@ez4/project/library';

import { EmulatorNotFoundError, EmulatorRequestHandlerNotFoundError } from '../src/emulator/errors';
import { getServiceEmulators } from '../src/emulator/service';
import { Tester } from '../src/emulator/tester';

type ProbeClient = {
  name: string;
  options?: AnyObject;
};

type ProbeContext = {
  other: ProbeClient;
};

const serveOptions: ServeOptions = {
  prefix: 'test',
  projectName: 'tester',
  branchName: '',
  serviceHost: 'localhost:0',
  localOptions: {},
  testOptions: {},
  version: 0
};

const realClient = { name: 'real' };

const queueService = {
  type: 'test',
  name: 'Queue',
  context: {},
  variables: {},
  services: {}
};

const apiService = {
  type: 'test:api',
  name: 'Api',
  context: {},
  services: {
    other: {
      reference: 'Other',
      options: {
        level: 'linked'
      }
    }
  }
};

const otherService = {
  type: 'test:client',
  name: 'Other',
  context: {}
};

const createGate = () => {
  let open = () => {};

  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return {
    promise,
    open
  };
};

// Fails instead of hanging when the promise never settles.
const settleWithin = <T>(promise: Promise<T>, milliseconds: number) => {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Not settled within ${milliseconds}ms.`)), milliseconds);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const receivedRequests: EmulatorRequestEvent[] = [];

let clientsGate = Promise.resolve();
let clientsArrival = () => {};

const lastRequest = () => {
  return receivedRequests[receivedRequests.length - 1];
};

tryCreateTrigger('@ez4/project:tester-spec', {
  'emulator:getServices': ({ service, options, context }: EmulateServiceEvent) => {
    switch (service.type) {
      case 'test:client':
        return {
          type: 'Client',
          name: service.name,
          identifier: getServiceName(service, options),
          options: {
            kind: 'emulator'
          },
          exportHandler: (clientOptions: AnyObject) => {
            return { name: 'real', options: clientOptions };
          }
        };

      case 'test:api':
        return {
          type: 'Api',
          name: service.name,
          identifier: getServiceName(service, options),
          requestHandler: async (request: EmulatorRequestEvent) => {
            receivedRequests.push(request);

            switch (request.path) {
              case '/echo':
                return {
                  status: 201,
                  headers: {
                    ['x-probe']: 'yes'
                  },
                  body: 'echoed'
                };

              case '/fail':
                throw new Error('Handler failure.');

              case '/clients': {
                clientsArrival();

                await clientsGate;

                const { other } = context.makeClients(service.services ?? {}) as ProbeContext;
                const direct = context.makeClient('Other') as ProbeClient;

                return {
                  status: 200,
                  body: JSON.stringify({
                    linked: other.name,
                    direct: direct.name
                  })
                };
              }
            }

            return undefined;
          }
        };
    }

    return null;
  }
});

const emulators = await getServiceEmulators({ Api: apiService, Other: otherService }, serveOptions);

emulators['test-tester-queue'] = {
  type: 'Queue',
  name: 'Queue',
  identifier: 'test-tester-queue',
  service: queueService,
  exportHandler: () => realClient
};

// A fresh module instance: `ez4 test` configures the packaged one for this project, which has no services.
Tester.configure(emulators, {
  prefix: 'test',
  projectName: 'tester',
  branchName: ''
});

const getResolvedClients = (response: Tester.Response) => {
  return JSON.parse(`${response.body}`);
};

describe('project tester', () => {
  it('assert :: restore a client that was never mocked', () => {
    Tester.restoreServiceClient('Queue');

    equal(Tester.getServiceClient('Queue'), realClient);
  });

  it('assert :: restore after mocking twice', () => {
    Tester.mockServiceClient('Queue', { name: 'first mock' });
    Tester.mockServiceClient('Queue', { name: 'second mock' });

    Tester.restoreServiceClient('Queue');

    equal(Tester.getServiceClient('Queue'), realClient);
  });

  it('assert :: service metadata', () => {
    equal(Tester.getServiceMetadata('Queue'), queueService);
    equal(Tester.getServiceMetadata('Unknown'), undefined);
  });

  it('assert :: mock an unknown service', () => {
    throws(() => Tester.mockServiceClient('Unknown', {}));
  });
});

describe('project tester request', () => {
  it('assert :: request with the default event', async () => {
    const response = await Tester.request('Api', {});

    deepEqual(response, {
      status: 204,
      headers: {}
    });

    deepEqual(lastRequest(), {
      method: 'POST',
      path: '/',
      headers: {},
      query: {},
      body: undefined
    });
  });

  it('assert :: request with a json body', async () => {
    const response = await Tester.request('Api', {
      method: 'PUT',
      path: '/echo',
      headers: {
        ['X-Trace-Id']: 'trace-1'
      },
      query: {
        page: '2'
      },
      body: {
        foo: 'bar'
      }
    });

    deepEqual(response, {
      status: 201,
      headers: {
        ['x-probe']: 'yes'
      },
      body: 'echoed'
    });

    deepEqual(lastRequest(), {
      method: 'PUT',
      path: '/echo',
      headers: {
        ['x-trace-id']: 'trace-1',
        ['content-type']: 'application/json'
      },
      query: {
        page: '2'
      },
      body: Buffer.from('{"foo":"bar"}')
    });
  });

  it('assert :: request with its own content type', async () => {
    await Tester.request('Api', {
      path: '/echo',
      headers: {
        ['Content-Type']: 'application/vnd.api+json'
      },
      body: {
        foo: 'bar'
      }
    });

    deepEqual(lastRequest().headers, {
      ['content-type']: 'application/vnd.api+json'
    });

    await Tester.request('Api', {
      path: '/echo',
      body: 'plain text'
    });

    deepEqual(lastRequest().headers, {});
    deepEqual(lastRequest().body, Buffer.from('plain text'));

    await Tester.request('Api', {
      path: '/echo',
      body: Buffer.from([1, 2, 3])
    });

    deepEqual(lastRequest().headers, {});
    deepEqual(lastRequest().body, Buffer.from([1, 2, 3]));
  });

  it('assert :: request failures', async () => {
    await rejects(() => Tester.request('Other', {}), EmulatorRequestHandlerNotFoundError);
    await rejects(() => Tester.request('Unknown', {}), EmulatorNotFoundError);

    await rejects(() => Tester.request('Api', {}, { services: { Unknown: {} } }), EmulatorNotFoundError);
    await rejects(() => Tester.request('Api', { path: '/fail' }), /Handler failure/);
  });

  it('assert :: overrides stay in the request that sets them', async () => {
    const gate = createGate();

    let arrivals = 0;

    const bothArrived = new Promise<void>((resolve) => {
      clientsArrival = () => {
        if (++arrivals === 2) {
          resolve();
        }
      };
    });

    clientsGate = gate.promise;

    try {
      const firstRequest = Tester.request('Api', { path: '/clients' }, { services: { Other: { name: 'first' } } });
      const secondRequest = Tester.request('Api', { path: '/clients' }, { services: { Other: { name: 'second' } } });

      await settleWithin(bothArrived, 1000);

      // Both requests are in flight, and what runs outside them still gets the real client.
      equal(Tester.getContext<ProbeContext>('Api').other.name, 'real');
      equal((Tester.getServiceClient('Other') as ProbeClient).name, 'real');

      gate.open();

      const [firstResponse, secondResponse] = await settleWithin(Promise.all([firstRequest, secondRequest]), 1000);

      deepEqual(getResolvedClients(firstResponse), { linked: 'first', direct: 'first' });
      deepEqual(getResolvedClients(secondResponse), { linked: 'second', direct: 'second' });

      const plainResponse = await Tester.request('Api', { path: '/clients' });

      deepEqual(getResolvedClients(plainResponse), { linked: 'real', direct: 'real' });
    } finally {
      clientsGate = Promise.resolve();
      clientsArrival = () => {};
    }
  });

  it('assert :: overrides go before a global mock', async () => {
    const globalMock = { name: 'global mock' };

    Tester.mockServiceClient('Other', globalMock);

    try {
      equal(Tester.getServiceClient('Other'), globalMock);
      equal(Tester.getContext<ProbeContext>('Api').other, globalMock);

      const response = await Tester.request('Api', { path: '/clients' }, { services: { Other: { name: 'override' } } });

      deepEqual(getResolvedClients(response), { linked: 'override', direct: 'override' });
    } finally {
      Tester.restoreServiceClient('Other');
    }

    equal((Tester.getServiceClient('Other') as ProbeClient).name, 'real');
  });

  it('assert :: context of a service', () => {
    const context = Tester.getContext<ProbeContext>('Api');

    // Built like the emulator builds a handler's clients: the emulator options, then the link options.
    deepEqual(context.other, {
      name: 'real',
      options: {
        kind: 'emulator',
        level: 'linked'
      }
    });

    const override = { name: 'override' };

    equal(Tester.getContext<ProbeContext>('Api', { other: override }).other, override);

    throws(() => Tester.getContext('Api', { unknown: {} }), /Context service 'unknown' not found/);
    throws(() => Tester.getContext('Unknown'), EmulatorNotFoundError);
  });
});
