import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { QueueImport, QueueService, QueueSubscription } from '@ez4/queue/library';
import type { Client, Queue } from '@ez4/queue';
import type { AnyObject } from '@ez4/utils';
import type { TestContext } from 'node:test';

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { Tester } from '@ez4/project/library';

import { registerLocalService } from '../src/provider/local';
import { registerRemoteService } from '../src/provider/remote';

export type TestMessage = {
  id: string;
  group?: string;
  note?: string;
};

export type ProbeRequest = {
  requestId: string;
  attempt: number;
  maxAttempts: number;
  traceId?: string;
  message: TestMessage;
  time: number;
};

export type ProbeEvent = {
  type: string;
  request: Partial<Queue.Incoming<TestMessage>>;
  time: number;
};

export type ProbeHandler = (request: Queue.Incoming<TestMessage>) => Promise<void> | void;

export type ProbeListener = (event: ProbeEvent) => void;

const PROBE_FILE = 'test/fixtures/queue-probe.ts';

export const serveOptions = {
  prefix: 'ez4',
  projectName: 'queue',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {}
} as ServeOptions;

export const emulatorContext = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

export const messageSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string'
    },
    group: {
      type: 'string',
      optional: true
    },
    note: {
      type: 'string',
      optional: true
    }
  }
};

export const getProbeSubscription = (subscription?: Partial<QueueSubscription>) => {
  return {
    handler: {
      name: 'probeHandler',
      file: PROBE_FILE,
      position: [1, 1]
    },
    listener: {
      name: 'probeListener',
      file: PROBE_FILE,
      position: [1, 1]
    },
    ...subscription
  } as QueueSubscription;
};

export const getQueueService = (name: string, service?: Partial<QueueService>) => {
  return {
    type: '@ez4/queue',
    name,
    services: {},
    variables: {},
    schema: messageSchema,
    subscriptions: [getProbeSubscription()],
    ...service
  } as QueueService;
};

export const getQueueImport = (name: string, service?: Partial<QueueImport>) => {
  return {
    type: '@ez4/import:queue',
    name,
    reference: 'ownerQueue',
    project: 'owner',
    services: {},
    variables: {},
    schema: messageSchema,
    subscriptions: [],
    ...service
  } as QueueImport;
};

export const getImportOptions = (ownerHost: string) => {
  return {
    ...serveOptions,
    imports: {
      owner: {
        prefix: 'ez4',
        projectName: 'owner',
        branchName: '',
        serviceHost: ownerHost
      }
    }
  } as ServeOptions;
};

// The handler module is imported once per serve version, so loading it first keeps the timed tests from waiting on it.
export const loadProbe = () => {
  const probeUrl = pathToFileURL(join(process.cwd(), PROBE_FILE));

  return import(`${probeUrl.href}?v=${serveOptions.version}`);
};

// The testers reach a queue through the project tester, which knows no services in this package.
const mockTesterClient = (t: TestContext, resourceName: string, getClient: () => unknown) => {
  const getServiceClient = Tester.getServiceClient;

  t.mock.method(Tester, 'getServiceClient', (name: string, options?: AnyObject) => {
    return name === resourceName ? getClient() : getServiceClient(name, options);
  });
};

export const registerQueue = (t: TestContext, service: QueueService) => {
  const emulator = registerLocalService(service, serveOptions, emulatorContext);

  t.after(() => emulator.shutdownHandler?.());

  mockTesterClient(t, service.name, () => emulator.exportHandler());

  return {
    emulator,
    client: emulator.exportHandler() as Client<TestMessage, any>,
    start: async () => {
      await emulator.bootstrapHandler?.();
    }
  };
};

export const startQueue = async (t: TestContext, service: QueueService) => {
  const queue = registerQueue(t, service);

  await queue.start();

  return queue;
};

export const registerImport = (t: TestContext, service: QueueImport, ownerHost: string) => {
  const emulator = registerRemoteService(service, getImportOptions(ownerHost));

  t.after(() => emulator.shutdownHandler?.());

  return {
    emulator,
    client: emulator.exportHandler() as Client<TestMessage, any>
  };
};

export const useQueueProbe = (t: TestContext) => {
  const requests: ProbeRequest[] = [];
  const events: ProbeEvent[] = [];

  let handleRequest: ProbeHandler = () => {};
  let handleEvent: ProbeListener = () => {};

  let running = 0;
  let maxRunning = 0;

  globalThis.queueProbe = {
    handler: async (incoming) => {
      const request = incoming as Queue.Incoming<TestMessage>;
      const { requestId, attempt, maxAttempts, traceId, message } = request;

      requests.push({ requestId, attempt, maxAttempts, traceId, message, time: Date.now() });

      maxRunning = Math.max(maxRunning, ++running);

      try {
        await handleRequest(request);
      } finally {
        running--;
      }
    },
    listener: (event) => {
      const probeEvent = {
        type: `${event.type}`,
        request: event.request as Partial<Queue.Incoming<TestMessage>>,
        time: Date.now()
      };

      events.push(probeEvent);

      handleEvent(probeEvent);
    }
  };

  t.after(() => {
    globalThis.queueProbe = undefined;
  });

  return {
    requests,
    events,
    getMaxRunning: () => maxRunning,
    getRuns: () => requests.map(({ message, attempt }) => [message.id, attempt]),
    setHandler: (handler: ProbeHandler) => {
      handleRequest = handler;
    },
    setListener: (listener: ProbeListener) => {
      handleEvent = listener;
    }
  };
};

export const createGate = () => {
  let open = () => {};

  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return {
    promise,
    open
  };
};
