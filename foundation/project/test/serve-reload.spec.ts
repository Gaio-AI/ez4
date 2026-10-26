import type { EmulateServiceEvent, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { MetadataReflection } from '../src/types/metadata';

import { describe, it } from 'node:test';
import { deepEqual, equal, notEqual } from 'node:assert/strict';

import { getServiceName, tryCreateTrigger } from '@ez4/project/library';

import { getMetadataSignature } from '../src/emulator/utils/reload';
import { reloadServices } from '../src/emulator/utils/hooks';
import { getServiceEmulators } from '../src/emulator/service';

type CounterClient = {
  made: number;
};

const getMetadata = (position: [number, number], handlerName = 'handleMessage', schemaPosition = 'number'): MetadataReflection => {
  return {
    Queue: {
      type: 'test:reload-queue',
      name: 'Queue',
      context: {},
      handler: {
        name: handlerName,
        file: 'src/queue.ts',
        position
      },
      schema: {
        type: 'object',
        properties: {
          position: {
            type: schemaPosition
          }
        }
      }
    }
  } as unknown as MetadataReflection;
};

let madeClients = 0;

tryCreateTrigger('@ez4/project:serve-reload-spec', {
  'emulator:getServices': ({ service, options, context }: EmulateServiceEvent) => {
    switch (service.type) {
      case 'test:reload-counter':
        return {
          type: 'Counter',
          name: service.name,
          identifier: getServiceName(service, options),
          exportHandler: () => () => ({ made: ++madeClients })
        };

      case 'test:reload-api':
        return {
          type: 'Api',
          name: service.name,
          identifier: getServiceName(service, options),
          requestHandler: (_request: EmulatorRequestEvent) => {
            const { counter } = context.makeClients(service.services ?? {}) as { counter: CounterClient };

            return {
              status: 200,
              body: `${counter.made}`
            };
          }
        };
    }

    return null;
  }
});

describe('serve reload', () => {
  it('assert :: a handler that moves keeps the metadata signature', () => {
    equal(getMetadataSignature(getMetadata([3, 1])), getMetadataSignature(getMetadata([9, 1])));
  });

  it('assert :: a schema property named position changes the signature', () => {
    notEqual(getMetadataSignature(getMetadata([3, 1])), getMetadataSignature(getMetadata([3, 1], 'handleMessage', 'string')));
  });

  it('assert :: another handler changes the signature', () => {
    notEqual(getMetadataSignature(getMetadata([3, 1])), getMetadataSignature(getMetadata([3, 1], 'handleOther')));
  });

  it('assert :: reload runs the reload handler of each emulator', async () => {
    const calls: string[] = [];

    await reloadServices({
      first: {
        type: 'Factory',
        name: 'First',
        identifier: 'first',
        reloadHandler: () => {
          calls.push('first');
        }
      },
      second: {
        type: 'Queue',
        name: 'Second',
        identifier: 'second'
      },
      third: {
        type: 'Validation',
        name: 'Third',
        identifier: 'third',
        reloadHandler: async () => {
          calls.push('third');
        }
      }
    });

    deepEqual(calls, ['first', 'third']);
  });

  it('assert :: clients are made again for a new version', async () => {
    const options: ServeOptions = {
      prefix: 'test',
      projectName: 'serve-reload',
      branchName: '',
      serviceHost: 'localhost:0',
      localOptions: {},
      testOptions: {},
      version: 1
    };

    const metadata = {
      Api: {
        type: 'test:reload-api',
        name: 'Api',
        context: {},
        services: {
          counter: {
            reference: 'Counter'
          }
        }
      },
      Counter: {
        type: 'test:reload-counter',
        name: 'Counter',
        context: {}
      }
    } as unknown as MetadataReflection;

    const emulators = await getServiceEmulators(metadata, options);
    const { requestHandler } = emulators[getServiceName('Api', options)];

    const request = { method: 'GET', path: '/', headers: {}, query: {} };

    const first = await requestHandler!(request);
    const second = await requestHandler!(request);

    options.version++;

    const third = await requestHandler!(request);

    equal(second?.body, first?.body);
    notEqual(third?.body, first?.body);
  });
});
