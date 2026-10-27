import type { Query, RelationMetadata } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';
import type { Object, ObjectSchema } from '@ez4/schema';

import { describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';
import { SqlBuilder } from '@ez4/pgsql';

import { prepareUpsertQuery } from '../../src/queries/upsert';

type TestTableMetadata = {
  engine: PostgresEngine;
  relations: RelationMetadata;
  indexes: {};
  schema: {
    id: string;
    email: string;
    counter?: number;
    status?: string | null;
    json?: {
      label?: string;
    };
    extensible?: Object.Any;
  };
};

describe('upsert schema', () => {
  const tableName = 'ez4-test-upsert';

  const testSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      id: {
        type: SchemaType.String
      },
      email: {
        type: SchemaType.String
      },
      counter: {
        type: SchemaType.Number,
        format: 'integer',
        optional: true
      },
      status: {
        type: SchemaType.String,
        optional: true,
        nullable: true
      },
      json: {
        type: SchemaType.Object,
        optional: true,
        properties: {
          label: {
            type: SchemaType.String,
            optional: true
          }
        }
      },
      extensible: {
        type: SchemaType.Object,
        optional: true,
        properties: {},
        definitions: {
          extensible: true
        }
      }
    }
  };

  const prepareUpsert = async <S extends Query.SelectInput<TestTableMetadata>>(
    input: Query.UpsertOneInput<S, TestTableMetadata>,
    conflictColumns: string[]
  ) => {
    const builder = new SqlBuilder();

    const result = await prepareUpsertQuery(builder, tableName, testSchema, {}, input, conflictColumns);

    return result && [...result.query.build(), result.columns, result.skipsUpdate];
  };

  it('assert :: prepare upsert (update with atomic operation and filters)', async ({ assert }) => {
    const [statement, variables, columns, skipsUpdate] = (await prepareUpsert(
      {
        select: {
          id: true,
          counter: true
        },
        insert: {
          id: 'abc',
          email: 'foo@test.com',
          counter: 1
        },
        update: {
          counter: {
            increment: 1
          },
          json: {
            label: 'bar'
          }
        },
        where: {
          email: 'foo@test.com',
          status: 'active'
        }
      },
      ['email']
    ))!;

    assert.equal(
      statement,
      `INSERT INTO "ez4-test-upsert" AS "R0" ("id", "email", "counter") VALUES (:0, :1, :2) ` +
        `ON CONFLICT ("email") DO UPDATE SET "counter" = ("R0"."counter" + :3), ` +
        `"json" = COALESCE("R0"."json", '{}'::jsonb) || jsonb_build_object(:4, :5) ` +
        `WHERE "R0"."status" = :6 ` +
        `RETURNING "R0"."id", "R0"."counter", ("R0".xmax = 0) AS "__EZ4_INSERTED"`
    );

    assert.deepEqual(variables, ['abc', 'foo@test.com', 1, 1, 'label', 'bar', 'active']);
    assert.deepEqual(columns, ['id', 'counter', '__EZ4_INSERTED']);
    assert.equal(skipsUpdate, false);
  });

  it('assert :: prepare upsert (filter by an empty object)', async ({ assert }) => {
    const [statement, variables] = (await prepareUpsert(
      {
        insert: {
          id: 'abc',
          email: 'foo@test.com'
        },
        update: {
          counter: 1
        },
        where: {
          email: 'foo@test.com',
          extensible: {
            equal: {}
          }
        }
      },
      ['email']
    ))!;

    assert.equal(
      statement,
      `INSERT INTO "ez4-test-upsert" AS "R0" ("id", "email") VALUES (:0, :1) ` +
        `ON CONFLICT ("email") DO UPDATE SET "counter" = :2 ` +
        `WHERE "R0"."extensible" = :3 ` +
        `RETURNING ("R0".xmax = 0) AS "__EZ4_INSERTED"`
    );

    assert.deepEqual(variables, ['abc', 'foo@test.com', 1, {}]);
  });

  it('assert :: prepare upsert (empty update)', async ({ assert }) => {
    const [statement, variables, columns, skipsUpdate] = (await prepareUpsert(
      {
        insert: {
          id: 'abc',
          email: 'foo@test.com'
        },
        update: {},
        where: {
          id: 'abc',
          status: 'active'
        }
      },
      ['id']
    ))!;

    assert.equal(
      statement,
      `INSERT INTO "ez4-test-upsert" AS "R0" ("id", "email") VALUES (:0, :1) ` +
        `ON CONFLICT ("id") DO NOTHING ` +
        `RETURNING ("R0".xmax = 0) AS "__EZ4_INSERTED"`
    );

    assert.deepEqual(variables, ['abc', 'foo@test.com']);
    assert.deepEqual(columns, ['__EZ4_INSERTED']);
    assert.equal(skipsUpdate, true);
  });

  it('assert :: prepare upsert (composite conflict target)', async ({ assert }) => {
    const [statement, variables] = (await prepareUpsert(
      {
        insert: {
          id: 'abc',
          email: 'foo@test.com',
          status: 'active'
        },
        update: {
          counter: 2
        },
        where: {
          email: 'foo@test.com',
          status: 'active'
        }
      },
      ['email', 'status']
    ))!;

    assert.equal(
      statement,
      `INSERT INTO "ez4-test-upsert" AS "R0" ("id", "email", "status") VALUES (:0, :1, :2) ` +
        `ON CONFLICT ("email", "status") DO UPDATE SET "counter" = :3 ` +
        `RETURNING ("R0".xmax = 0) AS "__EZ4_INSERTED"`
    );

    assert.deepEqual(variables, ['abc', 'foo@test.com', 'active', 2]);
  });

  it('assert :: prepare upsert (two steps)', async ({ assert }) => {
    const input = {
      insert: {
        id: 'abc',
        email: 'foo@test.com'
      },
      update: {
        counter: 2
      },
      where: {
        email: 'foo@test.com'
      }
    };

    // The record before the update.
    assert.equal(await prepareUpsert({ ...input, previous: true }, ['email']), undefined);

    // A null never conflicts.
    const nullInput = { ...input, insert: { ...input.insert, status: null }, where: { email: 'foo@test.com', status: null } };

    assert.equal(await prepareUpsert(nullInput, ['email', 'status']), undefined);

    // The insert doesn't carry the key the filters name.
    assert.equal(await prepareUpsert({ ...input, insert: { ...input.insert, email: 'bar@test.com' } }, ['email']), undefined);

    // The key isn't a plain value.
    assert.equal(await prepareUpsert({ ...input, where: { email: { equal: 'foo@test.com' } } as any }, ['email']), undefined);
  });
});
