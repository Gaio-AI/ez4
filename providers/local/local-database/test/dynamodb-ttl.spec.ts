import type { AttributeValue } from '@aws-sdk/client-dynamodb';

import { deepEqual, ok, rejects } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { StreamChangeType } from '@ez4/database';

import {
  createEmulator,
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

const putItem = (tableName: string, id: string, expiresAt?: number) => {
  const item: Record<string, AttributeValue> = {
    id: { S: id }
  };

  if (expiresAt !== undefined) {
    item.expiresAt = { N: `${expiresAt}` };
  }

  return dynamoDb.send(
    new PutItemCommand({
      TableName: tableName,
      Item: item
    })
  );
};

const hasItem = async (tableName: string, id: string) => {
  const { Item } = await dynamoDb.send(
    new GetItemCommand({
      TableName: tableName,
      ConsistentRead: true,
      Key: {
        id: { S: id }
      }
    })
  );

  return !!Item;
};

describe('local dynamodb ttl', { timeout: 20000 }, () => {
  afterEach(() => {
    resetObservers();
  });

  it('assert :: sweep expired items with a regular delete the stream handler receives', async () => {
    const service = getDatabaseService('ttlSweepDb', [
      {
        name: 'items',
        indexes: { id: 'primary', expiresAt: 'ttl' },
        stream: true
      },
      {
        name: 'sessions',
        indexes: { id: 'primary', expiresAt: 'ttl' }
      }
    ]);

    const options = getServeOptions(service.name, { localOptions: { ttlInterval: 0.2 } });

    const itemsTable = getTableName(service.name, 'items', options);
    const sessionsTable = getTableName(service.name, 'sessions', options);

    const changes = observeChanges();

    const getDeletedRecords = () => {
      return changes.flatMap(({ request }) => (request.type === StreamChangeType.Delete ? [request.record] : []));
    };

    await Promise.all([dropTable(itemsTable), dropTable(sessionsTable)]);

    const emulator = await startEmulator(service, options);

    try {
      const expiredAt = getEpochSeconds(-60);
      const dueAt = getEpochSeconds();

      await putItem(itemsTable, 'expired', expiredAt);
      await putItem(itemsTable, 'due', dueAt);
      await putItem(itemsTable, 'fresh', getEpochSeconds(3600));
      await putItem(itemsTable, 'forever');

      await putItem(sessionsTable, 'expired', expiredAt);
      await putItem(sessionsTable, 'fresh', getEpochSeconds(3600));

      ok(await waitUntil(() => getDeletedRecords().length === 2), `expected 2 deletes, got ${getDeletedRecords().length}`);

      deepEqual(
        getDeletedRecords().sort((a, b) => `${a.id}`.localeCompare(`${b.id}`)),
        [
          { id: 'due', expiresAt: dueAt },
          { id: 'expired', expiresAt: expiredAt }
        ]
      );

      ok(await waitUntil(async () => !(await hasItem(sessionsTable, 'expired'))), 'expired session is swept');

      ok(await hasItem(itemsTable, 'fresh'));
      ok(await hasItem(itemsTable, 'forever'));
      ok(await hasItem(sessionsTable, 'fresh'));
    } finally {
      await stopEmulator(emulator);
      await Promise.all([dropTable(itemsTable), dropTable(sessionsTable)]);
    }
  });

  it('assert :: keep expired items when the sweeper is turned off', async () => {
    const service = getDatabaseService('ttlOffDb', [{ name: 'items', indexes: { id: 'primary', expiresAt: 'ttl' } }]);

    const options = getServeOptions(service.name, { localOptions: { ttlSweeper: false, ttlInterval: 0.1 } });
    const tableName = getTableName(service.name, 'items', options);

    await dropTable(tableName);

    const emulator = await startEmulator(service, options);

    try {
      await putItem(tableName, 'expired', getEpochSeconds(-60));

      // Several sweep intervals.
      await setTimeout(600);

      ok(await hasItem(tableName, 'expired'));
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: keep expired items in test mode', async () => {
    const service = getDatabaseService('ttlTestModeDb', [{ name: 'items', indexes: { id: 'primary', expiresAt: 'ttl' } }]);

    const options = getServeOptions(service.name, { test: true, localOptions: { ttlInterval: 0.1 } });
    const tableName = getTableName(service.name, 'items', options);

    await dropTable(tableName);

    const emulator = await startEmulator(service, options);

    try {
      await putItem(tableName, 'expired', getEpochSeconds(-60));

      // Several sweep intervals.
      await setTimeout(600);

      ok(await hasItem(tableName, 'expired'));
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: reject an invalid sweep interval', async () => {
    const service = getDatabaseService('ttlIntervalDb', [{ name: 'items', indexes: { id: 'primary', expiresAt: 'ttl' } }]);

    const options = getServeOptions(service.name, { localOptions: { ttlInterval: 'soon' } });
    const tableName = getTableName(service.name, 'items', options);

    await dropTable(tableName);

    const emulator = await createEmulator(service, options);

    try {
      await rejects(async () => emulator.bootstrapHandler?.(), /ttlInterval/);
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });
});
