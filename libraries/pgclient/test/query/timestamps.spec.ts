import type { RelationMetadata } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';
import type { ObjectSchema } from '@ez4/schema';

import { describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';
import { SqlBuilder } from '@ez4/pgsql';

import { prepareUpdateQuery } from '../../src/queries/update';
import { prepareUpsertQuery } from '../../src/queries/upsert';
import { prepareInsertQuery } from '../../src/queries/insert';

type TestSchema = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

// Takes the timestamps in its data, as a caller without the types could give them.
type PlainTableMetadata = {
  engine: PostgresEngine;
  relations: RelationMetadata;
  indexes: {};
  schema: TestSchema;
};

type StampedTableMetadata = PlainTableMetadata & {
  timestamps: {
    created: 'created_at';
    updated: 'updated_at';
  };
};

describe('timestamps queries', () => {
  const tableName = 'ez4-test-timestamps';

  const timestamps = {
    created: 'created_at',
    updated: 'updated_at'
  };

  const testSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      id: {
        type: SchemaType.String
      },
      name: {
        type: SchemaType.String
      },
      created_at: {
        type: SchemaType.String,
        format: 'date-time'
      },
      updated_at: {
        type: SchemaType.String,
        format: 'date-time',
        definitions: {
          default: '2026-01-01T00:00:00.000Z'
        }
      }
    }
  };

  // The schema a table with timestamps inserts with.
  const insertSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      ...testSchema.properties,
      created_at: {
        type: SchemaType.String,
        format: 'date-time',
        optional: true
      },
      updated_at: {
        type: SchemaType.String,
        format: 'date-time',
        optional: true
      }
    }
  };

  const OLD_TIME = '2020-01-01T00:00:00.000Z';

  it('assert :: prepare insert without the timestamps', async ({ assert }) => {
    const builder = new SqlBuilder();

    const { queries } = await prepareInsertQuery<StampedTableMetadata, {}>(
      builder,
      tableName,
      insertSchema,
      {},
      {
        data: {
          id: 'abc',
          name: 'foo'
        }
      }
    );

    const [statement, variables] = builder.with(queries).build();

    assert.equal(statement, `INSERT INTO "ez4-test-timestamps" ("id", "name") VALUES (:0, :1)`);
    assert.deepEqual(variables, ['abc', 'foo']);
  });

  it('assert :: prepare update without the timestamps', async ({ assert }) => {
    const builder = new SqlBuilder();

    const { queries } = await prepareUpdateQuery<PlainTableMetadata, {}>(
      builder,
      tableName,
      testSchema,
      {},
      {
        data: {
          name: 'foo',
          created_at: OLD_TIME,
          updated_at: OLD_TIME
        },
        where: {
          id: 'abc'
        }
      },
      {
        timestamps
      }
    );

    const [statement, variables] = builder.with(queries).build();

    assert.equal(statement, `UPDATE ONLY "ez4-test-timestamps" SET "name" = :0 WHERE "id" = :1`);
    assert.deepEqual(variables, ['foo', 'abc']);
  });

  it('assert :: prepare update touching the record', async ({ assert }) => {
    const builder = new SqlBuilder();

    const { queries } = await prepareUpdateQuery<StampedTableMetadata, {}>(
      builder,
      tableName,
      testSchema,
      {},
      {
        touch: true,
        data: {},
        where: {
          id: 'abc'
        }
      },
      {
        timestamps
      }
    );

    const [statement, variables] = builder.with(queries).build();

    // Writing the column runs the trigger, which writes the timestamp.
    assert.equal(statement, `UPDATE ONLY "ez4-test-timestamps" SET "updated_at" = "updated_at" WHERE "id" = :0`);
    assert.deepEqual(variables, ['abc']);
  });

  it('assert :: prepare update touching the record (previous)', async ({ assert }) => {
    const builder = new SqlBuilder();

    const { queries } = await prepareUpdateQuery<StampedTableMetadata, { name: true }>(
      builder,
      tableName,
      testSchema,
      {},
      {
        touch: true,
        previous: true,
        select: {
          name: true
        },
        data: {},
        where: {
          id: 'abc'
        }
      },
      {
        primaryKey: ['id'],
        timestamps
      }
    );

    const [statement] = builder.with(queries).build();

    // The column of the updated table, which the source of the previous record has too.
    assert.match(statement, /UPDATE ONLY "ez4-test-timestamps" AS "U" SET "updated_at" = "U"\."updated_at" FROM /);
  });

  it('assert :: prepare upsert without the timestamps', async ({ assert }) => {
    const builder = new SqlBuilder();

    // As a caller without the types could give them.
    const update = {
      name: 'bar',
      created_at: OLD_TIME,
      updated_at: OLD_TIME
    };

    const result = await prepareUpsertQuery<StampedTableMetadata, {}>(
      builder,
      tableName,
      testSchema,
      {},
      {
        insert: {
          id: 'abc',
          name: 'foo'
        },
        update,
        where: {
          id: 'abc'
        }
      },
      ['id'],
      timestamps
    );

    const [statement, variables] = result!.query.build();

    assert.equal(
      statement,
      `INSERT INTO "ez4-test-timestamps" AS "R0" ("id", "name") VALUES (:0, :1) ` +
        `ON CONFLICT ("id") DO UPDATE SET "name" = :2 ` +
        `RETURNING ("R0".xmax = 0) AS "__EZ4_INSERTED"`
    );

    assert.deepEqual(variables, ['abc', 'foo', 'bar']);
  });
});
