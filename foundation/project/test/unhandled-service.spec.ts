import type { ServiceMetadata } from '@ez4/project/library';

import { afterEach, describe, it, mock } from 'node:test';
import { deepEqual, equal, throws } from 'node:assert/strict';

import { tryCreateTrigger } from '@ez4/project/library';
import { Logger } from '@ez4/logger';

import { buildMetadata } from '../src/library/metadata';

const sourceFile = 'test/files/unhandled-service.ts';

let handledServices: Record<string, ServiceMetadata> | null = null;

tryCreateTrigger('Test:unhandled-service', {
  'metadata:getServices': () => {
    return handledServices && { services: handledServices, errors: [] };
  }
});

describe('project unhandled services', () => {
  const error = mock.method(Logger, 'error', () => {});

  afterEach(() => {
    handledServices = null;
    error.mock.resetCalls();
  });

  it('assert :: a service no contract reads stops the metadata', () => {
    throws(() => buildMetadata([sourceFile]));

    const messages = error.mock.calls.map(({ arguments: [message] }) => message);

    equal(messages.length, 1);
    equal(messages[0]?.includes('Service UnhandledCron uses a contract from @ez4/scheduler'), true);
  });

  it('assert :: a service a contract reads is kept', () => {
    handledServices = {
      UnhandledCron: {
        type: '@ez4/cron',
        name: 'UnhandledCron',
        context: {},
        variables: {},
        services: {}
      }
    };

    const { metadata } = buildMetadata([sourceFile]);

    deepEqual(Object.keys(metadata), ['UnhandledCron']);
  });
});
