import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { CronService } from '@ez4/scheduler/library';
import type { Client } from '@ez4/scheduler';
import type { ObservedScope } from './fixtures/scope-probe';

import { deepEqual, equal, match } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Runtime } from '@ez4/common';

import { registerLocalService } from '../src/provider/local';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SCOPE_HEADERS = { clientVersion: 'x-client-version' };

const options = {
  prefix: 'ez4',
  projectName: 'scope',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {},
  suppress: true
} as ServeOptions;

const context = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

const getCronService = (name: string) => {
  return {
    type: '@ez4/scheduler',
    name,
    services: {},
    variables: {},
    expression: 'rate(1 minute)',
    schema: {
      type: 'object',
      properties: {
        foo: {
          type: 'string'
        }
      }
    },
    target: {
      handler: {
        name: 'probeScope',
        file: 'test/fixtures/scope-probe.ts',
        position: [1, 1]
      }
    }
  } as unknown as CronService;
};

const observeScopes = (count: number) => {
  const observed: ObservedScope[] = [];

  return new Promise<ObservedScope[]>((resolve) => {
    globalThis.observeScope = (entry) => {
      observed.push(entry);

      if (observed.length === count) {
        resolve(observed);
      }
    };
  });
};

describe('local scheduler scope', () => {
  afterEach(() => {
    globalThis.observeScope = undefined;
    Runtime.clearScope();
  });

  it('assert :: created event carries trace id and scope to the target', async () => {
    const scheduler = registerLocalService(getCronService('scopeCronCreate'), options, context);

    scheduler.bootstrapHandler();

    try {
      const client = scheduler.exportHandler() as Client<{ foo: string }>;
      const observed = observeScopes(1);

      Runtime.setScope({ traceId: 'trace-cron', clientVersion: '1.2.3' }, SCOPE_HEADERS);

      await client.createEvent('event-1', {
        date: new Date(Date.now() + 50),
        event: {
          foo: 'bar'
        }
      });

      Runtime.setScope({ traceId: 'after-create' });

      deepEqual(await observed, [
        {
          scope: {
            traceId: 'trace-cron',
            clientVersion: '1.2.3'
          },
          headers: SCOPE_HEADERS
        }
      ]);

      const stored = await client.getEvent('event-1');

      equal(stored !== undefined && 'traceId' in stored, false);
      equal(stored !== undefined && 'scope' in stored, false);
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: set event without scope keeps the trace id', async () => {
    const scheduler = registerLocalService(getCronService('scopeCronSet'), options, context);

    scheduler.bootstrapHandler();

    try {
      const client = scheduler.exportHandler() as Client<{ foo: string }>;
      const observed = observeScopes(1);

      Runtime.setScope({ traceId: 'trace-plain' });

      await client.setEvent('event-1', {
        date: new Date(Date.now() + 50),
        event: {
          foo: 'bar'
        }
      });

      deepEqual(await observed, [
        {
          scope: {
            traceId: 'trace-plain'
          },
          headers: {}
        }
      ]);
    } finally {
      scheduler.shutdownHandler();
    }
  });

  it('assert :: request without producer scope uses a fresh trace id', async () => {
    const scheduler = registerLocalService(getCronService('scopeCronRequest'), options, context);

    scheduler.bootstrapHandler();

    try {
      const observed = observeScopes(1);

      await scheduler.requestHandler({
        method: 'POST',
        path: '/',
        query: {},
        headers: {},
        body: Buffer.from(JSON.stringify({ foo: 'bar' }))
      });

      const [{ scope }] = await observed;

      match(scope?.traceId ?? '', UUID_PATTERN);
      deepEqual(Object.keys(scope ?? {}), ['traceId']);
    } finally {
      scheduler.shutdownHandler();
    }
  });
});
