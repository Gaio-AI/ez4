import type { EmulateServiceEvent } from '@ez4/project/library';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { tryCreateTrigger } from '@ez4/project/library';

import {
  createTestContext,
  dropTable,
  dynamoDb,
  getDatabaseService,
  getEpochSeconds,
  getServeOptions,
  getTableName,
  observeChanges,
  resetObservers,
  startEmulator,
  stopEmulator,
  waitUntil
} from './common/dynamodb';

const stopEvents: EmulateServiceEvent[] = [];

tryCreateTrigger('@ez4/local-database-test', {
  'emulator:stopService': (event) => {
    stopEvents.push(event);
  }
});

const putItem = (tableName: string, id: string, expiresAt?: number) => {
  return dynamoDb.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        id: { S: id },
        ...(expiresAt !== undefined && {
          expiresAt: { N: `${expiresAt}` }
        })
      }
    })
  );
};

describe('local dynamodb lifecycle', { timeout: 20000 }, () => {
  afterEach(() => {
    resetObservers();
  });

  it('assert :: shutdown triggers the stop event of the service', async () => {
    const service = getDatabaseService('lifecycleStopDb', [{ name: 'items', indexes: { id: 'primary' } }]);

    const options = getServeOptions(service.name, { test: true });
    const tableName = getTableName(service.name, 'items', options);

    const { context } = createTestContext();

    await dropTable(tableName);

    const emulator = await startEmulator(service, options, context);

    try {
      ok(emulator.shutdownHandler, 'database emulator has a shutdown handler');

      await emulator.shutdownHandler();

      deepEqual(
        stopEvents.filter((event) => event.service === service),
        [{ service, options, context }]
      );
    } finally {
      await dropTable(tableName);
    }
  });

  it('assert :: shutdown stops the stream consumer and the ttl sweeper', async () => {
    const service = getDatabaseService('lifecycleShutdownDb', [
      { name: 'items', indexes: { id: 'primary', expiresAt: 'ttl' }, stream: true }
    ]);

    const options = getServeOptions(service.name, { localOptions: { ttlInterval: 0.1 } });
    const tableName = getTableName(service.name, 'items', options);

    const changes = observeChanges();

    await dropTable(tableName);

    const emulator = await startEmulator(service, options);

    try {
      ok(emulator.shutdownHandler, 'database emulator has a shutdown handler');

      await emulator.shutdownHandler();

      await putItem(tableName, 'expired', getEpochSeconds(-60));

      // Longer than one poll of the stream consumer and several sweep intervals.
      await setTimeout(1500);

      equal(changes.length, 0);

      const { Item } = await dynamoDb.send(
        new GetItemCommand({
          TableName: tableName,
          ConsistentRead: true,
          Key: {
            id: { S: 'expired' }
          }
        })
      );

      ok(Item, 'expired item is kept after shutdown');
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: a second start keeps a single stream consumer', async () => {
    const service = getDatabaseService('lifecycleRestartDb', [{ name: 'items', indexes: { id: 'primary' }, stream: true }]);

    const options = getServeOptions(service.name);
    const tableName = getTableName(service.name, 'items', options);

    const changes = observeChanges();

    await dropTable(tableName);

    const emulator = await startEmulator(service, options);

    try {
      await emulator.bootstrapHandler?.();

      await putItem(tableName, 'foo');

      ok(await waitUntil(() => changes.length > 0), 'stream handler ran');

      // Longer than one poll of the stream consumer.
      await setTimeout(1500);

      equal(changes.length, 1);
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: a reload keeps a single stream consumer', async () => {
    const service = getDatabaseService('lifecycleReloadDb', [{ name: 'items', indexes: { id: 'primary' }, stream: true }]);

    const options = getServeOptions(service.name);
    const tableName = getTableName(service.name, 'items', options);

    const changes = observeChanges();

    await dropTable(tableName);

    const oldEmulator = await startEmulator(service, options);

    ok(oldEmulator.shutdownHandler, 'database emulator has a shutdown handler');

    await oldEmulator.shutdownHandler();

    const newEmulator = await startEmulator(service, { ...options, version: options.version + 1 });

    try {
      await putItem(tableName, 'foo');

      ok(await waitUntil(() => changes.length > 0), 'stream handler ran');

      // Longer than one poll of the stream consumer.
      await setTimeout(1500);

      equal(changes.length, 1);
    } finally {
      await stopEmulator(newEmulator);
      await dropTable(tableName);
    }
  });
});
