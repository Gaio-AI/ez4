import type { Database, Index } from '@ez4/database';
import type { DynamoDbEngine } from '@ez4/aws-dynamodb/client';

import { describe, it } from 'node:test';
import { rejects } from 'node:assert/strict';

import { Client, UnsupportedAggregateError } from '@ez4/aws-dynamodb/client';
import { SchemaType } from '@ez4/schema';

declare class TestSchema implements Database.Schema {
  id: string;
  value: number;
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

describe('dynamodb client aggregate', () => {
  const client = Client.make<TestDatabase>({
    repository: {
      testTable: {
        name: 'ez4-test-table-aggregate',
        indexes: [['id']],
        schema: {
          type: SchemaType.Object,
          properties: {
            id: {
              type: SchemaType.String
            },
            value: {
              type: SchemaType.Number
            }
          }
        }
      }
    }
  });

  it('assert :: aggregate is unsupported', async () => {
    await rejects(
      // @ts-expect-error DynamoDB tables have no aggregates.
      client.testTable.aggregate({
        select: {
          total: { count: true }
        }
      }),
      UnsupportedAggregateError
    );
  });
});
