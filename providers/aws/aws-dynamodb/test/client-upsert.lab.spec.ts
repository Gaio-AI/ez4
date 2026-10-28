import type { Database, Index, Client as DbClient } from '@ez4/database';
import type { DynamoDbEngine } from '@ez4/aws-dynamodb/client';
import type { EntryStates } from '@ez4/state';

import { ok, equal, deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTable, isTableState, AttributeType, AttributeKeyType, registerTriggers } from '@ez4/aws-dynamodb';
import { Client } from '@ez4/aws-dynamodb/client';
import { getRandomUUID } from '@ez4/utils';
import { SchemaType } from '@ez4/schema';
import { deploy } from '@ez4/aws-common';

declare class TestSchema implements Database.Schema {
  id: string;
  foo?: string;
  bar?: number;
}

declare class TestDatabase extends Database.Service<DynamoDbEngine> {
  tables: [
    {
      name: 'testTable';
      schema: TestSchema;
      indexes: {
        id: Index.Primary;
      };
    }
  ];
}

describe('dynamodb client upsert', { timeout: 60000 }, () => {
  let lastState: EntryStates | undefined;
  let dbClient: DbClient<TestDatabase> | undefined;
  let tableId: string | undefined;

  const tableName = 'ez4-test-table-client-upsert';

  const id = getRandomUUID();

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const resource = createTable(localState, {
      tableName,
      allowDeletion: true,
      attributeSchema: [
        [
          {
            attributeName: 'id',
            attributeType: AttributeType.String,
            keyType: AttributeKeyType.Hash
          }
        ]
      ]
    });

    tableId = resource.entryId;

    const { result } = await deploy(localState, undefined);

    const resultResource = result[tableId];

    ok(resultResource && isTableState(resultResource));
    ok(resultResource.result);

    lastState = result;

    dbClient = Client.make<TestDatabase>({
      repository: {
        testTable: {
          name: tableName,
          indexes: [['id']],
          schema: {
            type: SchemaType.Object,
            properties: {
              id: {
                type: SchemaType.String
              },
              foo: {
                type: SchemaType.String,
                optional: true
              },
              bar: {
                type: SchemaType.Number,
                optional: true
              }
            }
          }
        }
      }
    });

    ok(dbClient);
  });

  it('assert :: upsert without an update (no-op)', async () => {
    ok(dbClient);

    await dbClient.testTable.upsertOne({
      insert: {
        foo: 'abc',
        id
      },
      update: {
        bar: 123
      },
      where: {
        id
      }
    });

    const result = await dbClient.testTable.upsertOne({
      insert: {
        foo: 'abc',
        id
      },
      update: {},
      where: {
        id
      }
    });

    deepEqual(result, {
      inserted: false
    });
  });

  const otherId = getRandomUUID();

  it('assert :: upsert inserts a missing item with the insert, not the update', async () => {
    ok(dbClient);

    const result = await dbClient.testTable.upsertOne({
      insert: { id: otherId, foo: 'new', bar: 1 },
      update: { bar: 999 },
      where: { id: otherId }
    });

    deepEqual(result, { inserted: true });

    const item = await dbClient.testTable.findOne({ select: { foo: true, bar: true }, where: { id: otherId } });

    deepEqual(item, { foo: 'new', bar: 1 });
  });

  it('assert :: upsert updates an existing item with the update alone', async () => {
    ok(dbClient);

    const result = await dbClient.testTable.upsertOne({
      select: { foo: true, bar: true },
      insert: { id: otherId, foo: 'other', bar: 5 },
      update: { bar: 7 },
      where: { id: otherId }
    });

    deepEqual(result, { inserted: false, record: { foo: 'new', bar: 7 } });
  });

  it('assert :: upsert answers the record before the update with previous', async () => {
    ok(dbClient);

    const result = await dbClient.testTable.upsertOne({
      select: { bar: true },
      previous: true,
      insert: { id: otherId, foo: 'other', bar: 5 },
      update: { bar: 8 },
      where: { id: otherId }
    });

    deepEqual(result, { inserted: false, record: { bar: 7 } });
  });

  it('assert :: upsert with nothing to update leaves an existing item as it is', async () => {
    ok(dbClient);

    const result = await dbClient.testTable.upsertOne({
      insert: { id: otherId, foo: 'claim', bar: 0 },
      update: {},
      where: { id: otherId }
    });

    deepEqual(result, { inserted: false });

    const item = await dbClient.testTable.findOne({ select: { foo: true, bar: true }, where: { id: otherId } });

    deepEqual(item, { foo: 'new', bar: 8 });
  });

  it('assert :: upsert with nothing to update inserts a missing item', async () => {
    ok(dbClient);

    const claimId = getRandomUUID();

    const query = {
      insert: { id: claimId, foo: 'claim' },
      update: {},
      where: { id: claimId }
    };

    deepEqual(await dbClient.testTable.upsertOne(query), { inserted: true });
    deepEqual(await dbClient.testTable.upsertOne(query), { inserted: false });
  });

  it('assert :: destroy', async () => {
    ok(tableId && lastState);
    ok(lastState[tableId]);

    const { result } = await deploy(undefined, lastState);

    equal(result[tableId], undefined);

    dbClient = undefined;
  });
});
