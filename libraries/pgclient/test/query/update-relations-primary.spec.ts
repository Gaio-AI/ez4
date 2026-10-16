import type { Query, RelationMetadata } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';

import { describe, it } from 'node:test';

import { MalformedRequestError } from '@ez4/pgclient';
import { SqlBuilder } from '@ez4/pgsql';

import { getRelationsWithSchema } from '../../src/service/relations';
import { prepareUpdateQuery } from '../../src/queries/update';
import { TestRelationRepository } from '../client/common/relation';

type TestTableMetadata = {
  engine: PostgresEngine;
  relations: RelationMetadata;
  indexes: {};
  schema: {};
};

describe('update primary relations', () => {
  const tableName = 'table_b';

  const sourceId = '00000000-0000-1000-9000-000000000000';
  const targetId = '00000000-0000-1000-9000-000000000001';

  const prepareRelationUpdate = async <S extends Query.SelectInput<TestTableMetadata>>(
    input: Query.UpdateManyInput<S, TestTableMetadata>
  ) => {
    const repository = TestRelationRepository[tableName];
    const relations = getRelationsWithSchema(tableName, TestRelationRepository);
    const builder = new SqlBuilder();

    const { queries } = await prepareUpdateQuery(builder, tableName, repository.schema, relations, input, {
      primaryKey: ['id_b']
    });

    return builder.with(queries).build();
  };

  it('assert :: prepare empty relation (primary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation: {}
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_b" AS "R0" SET "value" = :0 WHERE "R0"."id_b" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_c" AS "S0" WHERE "S0"."unique_1_id" = "R0"."id_b" LIMIT 1) AS "relation"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare undefined relation (primary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation: {
          unique_1_id: undefined
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_b" AS "R0" SET "value" = :0 WHERE "R0"."id_b" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_c" AS "S0" WHERE "S0"."unique_1_id" = "R0"."id_b" LIMIT 1) AS "relation"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update relation (primary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      data: {
        value: 'foo',
        relation: {
          value: 'bar'
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Relation record
        `"Q0" AS (UPDATE ONLY "table_b" SET "value" = :0 WHERE "id_b" = :1 RETURNING "id_b") ` +
        // Main record
        `UPDATE ONLY "table_c" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."unique_1_id" = "Q0"."id_b"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update and select relation (primary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation: {
          value: 'bar'
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_b" SET "value" = :0 WHERE "id_b" = :1 RETURNING "id_b"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_c" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."unique_1_id" = "Q0"."id_b") ` +
        // Keys of the records to read again
        `SELECT "id_b" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update and select previous relation (primary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation: {
          value: true
        }
      },
      previous: true,
      data: {
        value: 'foo',
        relation: {
          value: 'bar'
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Previous records, locked in key order
        `"Q0" AS (SELECT "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_c" AS "S0" WHERE "S0"."unique_1_id" = "R0"."id_b" LIMIT 1) AS "relation", ` +
        `"R0"."id_b" AS "__EZ4_KEY_0" FROM "table_b" AS "R0" WHERE "R0"."id_b" = :0 ORDER BY "R0"."id_b" ASC FOR UPDATE), ` +
        // Main record, joined by key
        `"Q1" AS (UPDATE ONLY "table_b" AS "U" SET "value" = :1 FROM "Q0" WHERE "U"."id_b" = "Q0"."__EZ4_KEY_0" ` +
        `RETURNING "U"."id_b"), ` +
        // Relation record
        `"Q2" AS (UPDATE ONLY "table_c" AS "T" SET "value" = :2 FROM "Q1" WHERE "T"."unique_1_id" = "Q1"."id_b") ` +
        // Return
        `SELECT "value", "relation" FROM "Q0"`
    );

    assert.deepEqual(variables, [sourceId, 'foo', 'bar']);
  });

  it('assert :: prepare update, connect and select relation (primary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation: {
          unique_1_id: targetId
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_b" SET "value" = :0 WHERE "id_b" = :1 RETURNING "id_b"), ` +
        // Relation record (current)
        `"Q1" AS (UPDATE ONLY "table_c" AS "T" SET "unique_1_id" = null FROM "Q0" WHERE "T"."unique_1_id" = "Q0"."id_b" ` +
        `RETURNING "Q0"."id_b"), ` +
        // Relation record (new)
        `"Q2" AS (UPDATE ONLY "table_c" AS "T" SET "unique_1_id" = "Q1"."id_b" FROM "Q1" WHERE "T"."unique_1_id" = :2) ` +
        // Keys of the records to read again
        `SELECT "id_b" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, targetId]);
  });

  it('assert :: prepare update, disconnect and select relation (primary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation: {
          unique_1_id: null
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_b" SET "value" = :0 WHERE "id_b" = :1 RETURNING "id_b"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_c" AS "T" SET "unique_1_id" = null FROM "Q0" WHERE "T"."unique_1_id" = "Q0"."id_b") ` +
        // Keys of the records to read again
        `SELECT "id_b" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update invalid connection (primary to unique)', async ({ assert }) => {
    await assert.rejects(
      () =>
        prepareRelationUpdate({
          data: {
            value: 'foo',
            relation: {
              unique_1_id: targetId,

              // Extra fields aren't expected.
              extra: 'foo'
            }
          }
        }),
      MalformedRequestError
    );
  });

  it('assert :: prepare empty relation (primary to secondary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relations: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relations: {}
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_b" AS "R0" SET "value" = :0 WHERE "R0"."id_b" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT COALESCE(json_agg(jsonb_build_object('value', "S0"."value")), '[]'::json) ` +
        `FROM "table_a" AS "S0" WHERE "S0"."relation_1_id" = "R0"."id_b") AS "relations"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare undefined relation (primary to secondary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relations: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relations: {
          id_a: undefined
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_b" AS "R0" SET "value" = :0 WHERE "R0"."id_b" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT COALESCE(json_agg(jsonb_build_object('value', "S0"."value")), '[]'::json) ` +
        `FROM "table_a" AS "S0" WHERE "S0"."relation_1_id" = "R0"."id_b") AS "relations"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update relation (primary to secondary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      data: {
        value: 'foo',
        relations: {
          value: 'bar'
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_b" SET "value" = :0 WHERE "id_b" = :1 ` +
        `RETURNING "id_b") ` +
        // Relation record
        `UPDATE ONLY "table_a" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."relation_1_id" = "Q0"."id_b"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update and select relation (primary to secondary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relations: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relations: {
          value: 'bar'
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_b" SET "value" = :0 WHERE "id_b" = :1 RETURNING "id_b"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_a" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."relation_1_id" = "Q0"."id_b") ` +
        // Keys of the records to read again
        `SELECT "id_b" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update, connect and select relation (primary to secondary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relations: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relations: {
          id_a: targetId
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_b" SET "value" = :0 WHERE "id_b" = :1 RETURNING "id_b"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_a" AS "T" SET "relation_1_id" = "Q0"."id_b" FROM "Q0" WHERE "T"."id_a" = :2) ` +
        // Keys of the records to read again
        `SELECT "id_b" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, targetId]);
  });

  it('assert :: prepare update, disconnect and select relation (primary to secondary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relations: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relations: {
          id_a: null
        }
      },
      where: {
        id_b: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_b" SET "value" = :0 WHERE "id_b" = :1 RETURNING "id_b"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_a" AS "T" SET "relation_1_id" = null FROM "Q0" WHERE "T"."relation_1_id" = "Q0"."id_b") ` +
        // Keys of the records to read again
        `SELECT "id_b" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update invalid connection (primary to secondary)', async ({ assert }) => {
    await assert.rejects(
      () =>
        prepareRelationUpdate({
          data: {
            value: 'foo',
            relations: {
              id_a: targetId,

              // Extra fields aren't expected.
              extra: 'foo'
            }
          }
        }),
      MalformedRequestError
    );
  });
});
