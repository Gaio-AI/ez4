import type { EmulateServiceContext, EmulatorServiceClients, LinkedServices, ServeOptions, ServiceEmulator } from '@ez4/project/library';
import type { DatabaseService, DatabaseTable } from '@ez4/database/library';
import type { AnyObject } from '@ez4/utils';
import type { ObservedChange, ObservedEvent } from '../fixtures/stream-handler';

import { DeleteTableCommand, DescribeTableCommand, DynamoDBClient, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { registerTriggers } from '@ez4/aws-dynamodb';
import { getServiceName } from '@ez4/project/library';
import { toKebabCase, toSnakeCase } from '@ez4/utils';

import { setTimeout } from 'node:timers/promises';
import { ok } from 'node:assert/strict';

import { registerDatabaseEmulator } from '../../src/provider/emulator';

registerTriggers();

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const dynamoDb = new DynamoDBClient({
  endpoint: 'http://127.0.0.1:8000'
});

export const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: {
      type: 'string'
    },
    order: {
      type: 'number',
      optional: true
    },
    value: {
      type: 'number',
      optional: true
    },
    email: {
      type: 'string',
      optional: true
    },
    expiresAt: {
      type: 'number',
      optional: true
    }
  }
};

export type TestTable = {
  name: string;
  indexes: Record<string, string>;
  references?: string[];
  stream?: boolean;
};

export type TestOptions = {
  localOptions?: AnyObject;
  test?: boolean;
};

export const getDatabaseService = (name: string, tables: TestTable[], services: LinkedServices = {}) => {
  return {
    type: '@ez4/database',
    context: {},
    engine: {
      name: 'dynamodb'
    },
    variables: {},
    services,
    tables: tables.map((table) => getDatabaseTable(table)),
    name
  } as unknown as DatabaseService;
};

const getDatabaseTable = (table: TestTable) => {
  const indexes = Object.entries(table.indexes).map(([name, type]) => ({
    columns: name.split(':'),
    name,
    type
  }));

  return {
    name: table.name,
    schema: ITEM_SCHEMA,
    indexes,
    ...(table.stream && {
      stream: {
        handler: {
          name: 'streamHandler',
          file: 'test/fixtures/stream-handler.ts',
          position: [1, 1],
          references: table.references
        },
        listener: {
          name: 'streamListener',
          file: 'test/fixtures/stream-handler.ts',
          position: [1, 1]
        }
      }
    })
  } as unknown as DatabaseTable;
};

export const getServeOptions = (serviceName: string, options?: TestOptions): ServeOptions => {
  return {
    prefix: 'ez4',
    projectName: 'local-database',
    branchName: '',
    serviceHost: 'localhost:0',
    version: 1,
    local: true,
    localOptions: {
      [toSnakeCase(serviceName)]: {
        host: '127.0.0.1',
        port: 8000,
        ...options?.localOptions
      }
    },
    testOptions: {},
    ...(options?.test && {
      suppress: true,
      test: true
    })
  };
};

export const getTableName = (serviceName: string, tableName: string, options: ServeOptions) => {
  return `${getServiceName(serviceName, options)}-${toKebabCase(tableName)}`;
};

export const createTestContext = (clients: EmulatorServiceClients = {}) => {
  const linkedServices: LinkedServices[] = [];

  const context: EmulateServiceContext = {
    makeClients: (services) => {
      linkedServices.push(services);
      return clients;
    },
    makeClient: () => {
      return undefined;
    }
  };

  return {
    linkedServices,
    context
  };
};

export const createEmulator = async (service: DatabaseService, options: ServeOptions, context = createTestContext().context) => {
  const emulator = await registerDatabaseEmulator(service, options, context);

  ok(emulator, 'database emulator is registered');

  return emulator;
};

export const startEmulator = async (service: DatabaseService, options: ServeOptions, context?: EmulateServiceContext) => {
  const emulator = await createEmulator(service, options, context);

  await emulator.bootstrapHandler?.();

  return emulator;
};

export const stopEmulator = async (emulator: ServiceEmulator | undefined) => {
  await emulator?.shutdownHandler?.();
};

export const describeTable = async (tableName: string) => {
  const { Table } = await dynamoDb.send(
    new DescribeTableCommand({
      TableName: tableName
    })
  );

  return Table;
};

export const dropTable = async (tableName: string) => {
  try {
    await dynamoDb.send(
      new DeleteTableCommand({
        TableName: tableName
      })
    );
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  }
};

export const observeChanges = (callback?: (observed: ObservedChange) => Promise<void> | void) => {
  const changes: ObservedChange[] = [];

  globalThis.observeChange = (observed) => {
    changes.push(observed);
    return callback?.(observed);
  };

  return changes;
};

export const observeEvents = () => {
  const events: ObservedEvent[] = [];

  globalThis.observeEvent = (observed) => {
    events.push(observed);
  };

  return events;
};

export const resetObservers = () => {
  globalThis.observeChange = undefined;
  globalThis.observeEvent = undefined;
};

export const waitUntil = async (condition: () => Promise<boolean> | boolean, timeout = 4000) => {
  const deadline = Date.now() + timeout;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      return false;
    }

    await setTimeout(50);
  }

  return true;
};

export const getEpochSeconds = (offset = 0) => {
  return Math.floor(Date.now() / 1000) + offset;
};
