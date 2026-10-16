import type { Database, Index, Client as DbClient } from '@ez4/database';
import type { DynamoDbEngine } from '@ez4/aws-dynamodb/client';
import type { EntryStates } from '@ez4/state';

import { ok, equal, deepEqual, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTable, isTableState, AttributeType, AttributeKeyType, registerTriggers } from '@ez4/aws-dynamodb';
import { Client } from '@ez4/aws-dynamodb/client';
import { SchemaType } from '@ez4/schema';
import { deploy } from '@ez4/aws-common';

declare class TestSchema implements Database.Schema {
  id: string;
  order: number;
  value: string;
}

declare class Test extends Database.Service<DynamoDbEngine> {
  tables: [
    {
      name: 'testTable';
      schema: TestSchema;
      indexes: {
        'id:order': Index.Primary;
      };
    }
  ];
}

describe('dynamodb client (insert many)', { timeout: 60000 }, () => {
  let lastState: EntryStates | undefined;
  let dbClient: DbClient<Test>;
  let tableId: string | undefined;

  const tableName = 'ez4-test-table-client-insert-many';

  const makeItems = (prefix: string, length: number) => {
    return Array.from({ length }, (_, index) => ({
      id: `${prefix}-${index}`,
      order: index,
      value: prefix
    }));
  };

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
          },
          {
            attributeName: 'order',
            attributeType: AttributeType.Number,
            keyType: AttributeKeyType.Range
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

    dbClient = Client.make({
      repository: {
        testTable: {
          name: tableName,
          indexes: [['id', 'order']],
          schema: {
            type: SchemaType.Object,
            properties: {
              id: {
                type: SchemaType.String
              },
              order: {
                type: SchemaType.Number
              },
              value: {
                type: SchemaType.String
              }
            }
          }
        }
      }
    });

    ok(dbClient);
  });

  it('assert :: insert many with select', async () => {
    ok(dbClient);

    const records = await dbClient.testTable.insertMany({
      select: {
        id: true,
        order: true
      },
      data: makeItems('select', 2)
    });

    deepEqual(records, [
      { id: 'select-0', order: 0 },
      { id: 'select-1', order: 1 }
    ]);
  });

  it('assert :: insert many with a duplicate', async () => {
    ok(dbClient);

    await rejects(() => dbClient.testTable.insertMany({ data: [...makeItems('select', 1), ...makeItems('failed', 1)] }));

    const exists = await dbClient.testTable.exists({
      where: {
        value: 'failed'
      }
    });

    equal(exists, false);
  });

  it('assert :: insert many skipping duplicates', async () => {
    ok(dbClient);

    await dbClient.testTable.insertMany({
      data: makeItems('skip', 250).filter(({ order }) => order % 5 === 0)
    });

    const records = await dbClient.testTable.insertMany({
      skipDuplicates: true,
      select: {
        id: true
      },
      data: makeItems('skip', 250)
    });

    equal(records.length, 200);

    ok(records.every(({ id }) => Number(id.split('-')[1]) % 5 !== 0));

    const total = await dbClient.testTable.count({
      where: {
        value: 'skip'
      }
    });

    equal(total, 250);
  });

  it('assert :: destroy', async () => {
    ok(tableId && lastState);
    ok(lastState[tableId]);

    const { result } = await deploy(undefined, lastState);

    equal(result[tableId], undefined);
  });
});
