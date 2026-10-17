import type { Query, RelationMetadata } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';
import type { AnyObject } from '@ez4/utils';

import { describe, it } from 'node:test';

import { SqlBuilder } from '@ez4/pgsql';

import { getRelationsWithSchema } from '../../src/service/relations';
import { getInsertManyRecords, prepareInsertManyQuery, prepareInsertQuery } from '../../src/queries/insert';
import { prepareUpsertQuery } from '../../src/queries/upsert';
import { prepareUpdateQuery } from '../../src/queries/update';
import { TestPrimaryRelationRepository } from '../client/common/primary-relation';

type TestTableMetadata = {
  engine: PostgresEngine;
  relations: RelationMetadata;
  indexes: {};
  schema: {};
};

describe('primary key relations', () => {
  const tableName = 'table_account_stats';

  const accountId = '00000000-0000-1000-9000-000000000000';
  const otherAccountId = '00000000-0000-1000-9000-000000000001';

  const repository = TestPrimaryRelationRepository[tableName];
  const relations = getRelationsWithSchema(tableName, TestPrimaryRelationRepository);

  const prepareRelationInsert = async <S extends Query.SelectInput<TestTableMetadata>>(
    input: Query.InsertOneInput<S, TestTableMetadata>,
    skipConflicts?: boolean
  ) => {
    const builder = new SqlBuilder();

    const { queries } = await prepareInsertQuery(builder, tableName, repository.schema, relations, input, { skipConflicts });

    return builder.with(queries).build();
  };

  const prepareRelationUpsert = async <S extends Query.SelectInput<TestTableMetadata>>(
    input: Query.UpsertOneInput<S, TestTableMetadata>
  ) => {
    const builder = new SqlBuilder();

    const result = await prepareUpsertQuery(builder, tableName, repository.schema, relations, input, ['account_id']);

    return result && result.query.build();
  };

  const prepareRelationInsertMany = async (data: AnyObject[]) => {
    const builder = new SqlBuilder();

    const records = await getInsertManyRecords(data, repository.schema, relations, tableName);

    const { query } = prepareInsertManyQuery<TestTableMetadata, AnyObject>(builder, tableName, repository.schema, records, {});

    return query.build();
  };

  const prepareRelationUpdate = async <S extends Query.SelectInput<TestTableMetadata>>(
    input: Query.UpdateManyInput<S, TestTableMetadata>
  ) => {
    const builder = new SqlBuilder();

    const { queries } = await prepareUpdateQuery(builder, tableName, repository.schema, relations, input, {
      primaryKey: ['account_id']
    });

    return builder.with(queries).build();
  };

  it('assert :: prepare insert and connect relation (primary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationInsert({
      data: {
        total: 1,
        account: {
          id: accountId
        }
      }
    });

    assert.equal(statement, `INSERT INTO "table_account_stats" ("total", "account_id") VALUES (:0, :1)`);

    assert.deepEqual(variables, [1, accountId]);
  });

  it('assert :: prepare insert, connect and select relation (primary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationInsert({
      select: {
        total: true,
        account: {
          id: true,
          value: true
        }
      },
      data: {
        total: 1,
        account: {
          id: accountId
        }
      }
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (INSERT INTO "table_account_stats" ("total", "account_id") VALUES (:0, :1) ` +
        `RETURNING "total", "account_id") ` +
        // Return
        `SELECT "total", ` +
        `(SELECT jsonb_build_object('id', "S0"."id", 'value', "S0"."value") ` +
        `FROM "table_account" AS "S0" WHERE "S0"."id" = "account_id") AS "account" ` +
        `FROM "Q0"`
    );

    assert.deepEqual(variables, [1, accountId]);
  });

  it('assert :: prepare insert skipping conflicts and connect relation (primary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationInsert(
      {
        data: {
          total: 1,
          account: {
            id: accountId
          }
        }
      },
      true
    );

    assert.equal(statement, `INSERT INTO "table_account_stats" ("total", "account_id") VALUES (:0, :1) ON CONFLICT DO NOTHING`);

    assert.deepEqual(variables, [1, accountId]);
  });

  it('assert :: prepare insert and create relation (primary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationInsert({
      data: {
        total: 1,
        account: {
          id: accountId,
          value: 'foo'
        }
      }
    });

    assert.equal(
      statement,
      `WITH ` +
        // Relation record
        `"Q0" AS (INSERT INTO "table_account" ("id", "value") VALUES (:0, :1) ` +
        `RETURNING "id") ` +
        // Main record
        `INSERT INTO "table_account_stats" ("total", "account_id") SELECT :2, "Q0"."id" FROM "Q0"`
    );

    assert.deepEqual(variables, [accountId, 'foo', 1]);
  });

  it('assert :: prepare upsert and connect relation (primary to primary)', async ({ assert }) => {
    const result = await prepareRelationUpsert({
      insert: {
        total: 1,
        account: {
          id: accountId
        }
      },
      update: {
        total: 2
      },
      where: {
        account_id: accountId
      } as any
    });

    // One statement, instead of the update followed by the insert.
    assert.notEqual(result, undefined);

    const [statement, variables] = result!;

    assert.equal(
      statement,
      `INSERT INTO "table_account_stats" AS "R0" ("total", "account_id") VALUES (:0, :1) ` +
        `ON CONFLICT ("account_id") DO UPDATE SET "total" = :2 ` +
        `RETURNING ("R0".xmax = 0) AS "__EZ4_INSERTED"`
    );

    assert.deepEqual(variables, [1, accountId, 2]);
  });

  it('assert :: prepare insert many (primary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationInsertMany([
      { account_id: accountId, total: 1 },
      { account_id: otherAccountId, total: 2 }
    ]);

    assert.equal(statement, `INSERT INTO "table_account_stats" ("account_id", "total") VALUES (:0, :1), (:2, :3)`);

    assert.deepEqual(variables, [accountId, 1, otherAccountId, 2]);
  });

  it('assert :: prepare update and connect relation (primary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      data: {
        account: {
          id: otherAccountId
        }
      },
      where: {
        account_id: accountId
      } as any
    });

    assert.equal(statement, `UPDATE ONLY "table_account_stats" SET "account_id" = :0 WHERE "account_id" = :1`);

    assert.deepEqual(variables, [otherAccountId, accountId]);
  });
});
