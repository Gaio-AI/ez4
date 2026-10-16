import type { RelationMetadata } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';
import type { ObjectSchema } from '@ez4/schema';
import type { AnyObject } from '@ez4/utils';

import { describe, it } from 'node:test';

import { getInsertManyRecords, prepareInsertManyQuery } from '../../src/queries/insert';
import { MissingFieldSchemaError } from '@ez4/pgclient';
import { SchemaType } from '@ez4/schema';
import { SqlBuilder } from '@ez4/pgsql';

type TestTableMetadata = {
  engine: PostgresEngine;
  relations: RelationMetadata;
  indexes: {};
  schema: {};
};

describe('insert many schema', () => {
  const tableName = 'ez4-test-insert-many';

  const testSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      id: {
        type: SchemaType.String
      },
      datetime: {
        type: SchemaType.String,
        format: 'date-time',
        optional: true
      },
      json: {
        type: SchemaType.Object,
        optional: true,
        nullable: true,
        properties: {
          label: {
            type: SchemaType.String
          }
        }
      }
    }
  };

  const prepareInsertMany = async (data: AnyObject[], input: { select?: AnyObject; skipDuplicates?: boolean }) => {
    const builder = new SqlBuilder();

    const records = await getInsertManyRecords(data, testSchema, {}, tableName);

    const { query, columns } = prepareInsertManyQuery<TestTableMetadata, AnyObject>(builder, tableName, testSchema, records, input);

    return [...query.build(), columns];
  };

  it('assert :: prepare insert many', async ({ assert }) => {
    const [statement, variables, columns] = await prepareInsertMany(
      [
        { id: 'abc', datetime: '2024-07-01T08:00:00.000Z' },
        { id: 'def', json: null },
        { id: 'ghi', json: { label: 'foo' } }
      ],
      {}
    );

    assert.equal(
      statement,
      `INSERT INTO "ez4-test-insert-many" ("id", "datetime", "json") VALUES (:0, :1, DEFAULT), (:2, DEFAULT, null), (:3, DEFAULT, :4)`
    );

    assert.deepEqual(variables, ['abc', '2024-07-01T08:00:00.000Z', 'def', 'ghi', { label: 'foo' }]);
    assert.deepEqual(columns, []);
  });

  it('assert :: prepare insert many (skip duplicates and select)', async ({ assert }) => {
    const [statement, variables, columns] = await prepareInsertMany([{ id: 'abc', datetime: '2024-07-01T08:00:00.000Z' }, { id: 'def' }], {
      skipDuplicates: true,
      select: {
        id: true,
        datetime: true,
        json: {
          label: true
        }
      }
    });

    assert.equal(
      statement,
      `INSERT INTO "ez4-test-insert-many" ("id", "datetime") VALUES (:0, :1), (:2, DEFAULT) ON CONFLICT DO NOTHING ` +
        `RETURNING "id", to_char("datetime", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "datetime", ` +
        `jsonb_build_object('label', "json"['label']) AS "json"`
    );

    assert.deepEqual(variables, ['abc', '2024-07-01T08:00:00.000Z', 'def']);
    assert.deepEqual(columns, ['id', 'datetime', 'json']);
  });

  it('assert :: prepare insert many (relation select)', async ({ assert }) => {
    await assert.rejects(() => prepareInsertMany([{ id: 'abc' }], { select: { relation: { id: true } } }), MissingFieldSchemaError);
  });
});
