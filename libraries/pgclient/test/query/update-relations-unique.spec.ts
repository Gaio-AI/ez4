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

describe('update unique relations', () => {
  const tableName = 'table_c';

  const sourceId = '00000000-0000-1000-9000-000000000000';
  const targetId = '00000000-0000-1000-9000-000000000001';

  const prepareRelationUpdate = async <S extends Query.SelectInput<TestTableMetadata>>(
    input: Query.UpdateManyInput<S, TestTableMetadata>
  ) => {
    const repository = TestRelationRepository[tableName];
    const relations = getRelationsWithSchema(tableName, TestRelationRepository);
    const builder = new SqlBuilder();

    const { queries } = await prepareUpdateQuery(builder, tableName, repository.schema, relations, input, {
      primaryKey: ['id_c']
    });

    return builder.with(queries).build();
  };

  it('assert :: prepare empty relation (unique to primary)', async ({ assert }) => {
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
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0 WHERE "R0"."id_c" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."id_b" = "R0"."unique_1_id" LIMIT 1) AS "relation"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare undefined relation (unique to primary)', async ({ assert }) => {
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
          id_b: undefined
        }
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0 WHERE "R0"."id_c" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."id_b" = "R0"."unique_1_id" LIMIT 1) AS "relation"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update relation (unique to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      data: {
        value: 'foo',
        relation: {
          value: 'bar'
        }
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_c" SET "value" = :0 WHERE "id_c" = :1 ` +
        `RETURNING "unique_1_id") ` +
        // Relation record
        `UPDATE ONLY "table_b" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."id_b" = "Q0"."unique_1_id"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update and select relation (unique to primary)', async ({ assert }) => {
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
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_c" SET "value" = :0 WHERE "id_c" = :1 RETURNING "id_c", "unique_1_id"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_b" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."id_b" = "Q0"."unique_1_id") ` +
        // Keys of the records to read again
        `SELECT "id_c" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update, connect and select relation (unique to primary)', async ({ assert }) => {
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
          id_b: targetId
        }
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0, "unique_1_id" = :1 WHERE "R0"."id_c" = :2 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."id_b" = "R0"."unique_1_id" LIMIT 1) AS "relation"`
    );

    assert.deepEqual(variables, ['foo', targetId, sourceId]);
  });

  it('assert :: prepare update, disconnect and select relation (unique to primary)', async ({ assert }) => {
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
          id_b: null
        }
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0, "unique_1_id" = null WHERE "R0"."id_c" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."id_b" = "R0"."unique_1_id" LIMIT 1) AS "relation"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update invalid connection (unique to primary)', async ({ assert }) => {
    await assert.rejects(
      () =>
        prepareRelationUpdate({
          data: {
            value: 'foo',
            relation: {
              id_b: targetId,

              // Extra fields aren't expected.
              extra: 'foo'
            }
          }
        }),
      MalformedRequestError
    );
  });

  it('assert :: prepare empty relation (unique to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_unique: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_unique: {}
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0 WHERE "R0"."id_c" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."unique_b" = "R0"."unique_3_id" LIMIT 1) AS "relation_unique"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare undefined relation (unique to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_unique: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_unique: {
          unique_b: undefined
        }
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0 WHERE "R0"."id_c" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."unique_b" = "R0"."unique_3_id" LIMIT 1) AS "relation_unique"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update relation (unique to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      data: {
        value: 'foo',
        relation_unique: {
          value: 'bar'
        }
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_c" SET "value" = :0 WHERE "id_c" = :1 ` +
        `RETURNING "unique_3_id") ` +
        // Relation record
        `UPDATE ONLY "table_b" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."unique_b" = "Q0"."unique_3_id"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update and select relation (unique to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_unique: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_unique: {
          value: 'bar'
        }
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_c" SET "value" = :0 WHERE "id_c" = :1 RETURNING "id_c", "unique_3_id"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_b" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."unique_b" = "Q0"."unique_3_id") ` +
        // Keys of the records to read again
        `SELECT "id_c" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update, connect and select relation (unique to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_unique: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_unique: {
          unique_b: targetId
        }
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      // The record holds the foreign key, so connecting rewrites its own column.
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0, "unique_3_id" = :1 WHERE "R0"."id_c" = :2 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."unique_b" = "R0"."unique_3_id" LIMIT 1) AS "relation_unique"`
    );

    assert.deepEqual(variables, ['foo', targetId, sourceId]);
  });

  it('assert :: prepare update, disconnect and select relation (unique to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_unique: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_unique: {
          unique_b: null
        }
      },
      where: {
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      // The record holds the foreign key, so disconnecting clears its own column.
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0, "unique_3_id" = null WHERE "R0"."id_c" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."unique_b" = "R0"."unique_3_id" LIMIT 1) AS "relation_unique"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update invalid connection (unique to unique)', async ({ assert }) => {
    await assert.rejects(
      () =>
        prepareRelationUpdate({
          data: {
            value: 'foo',
            relation_unique: {
              unique_b: targetId,

              // Extra fields aren't expected.
              extra: 'foo'
            }
          }
        }),
      MalformedRequestError
    );
  });

  it('assert :: prepare empty relation (unique to secondary)', async ({ assert }) => {
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
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0 WHERE "R0"."id_c" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT COALESCE(json_agg(jsonb_build_object('value', "S0"."value")), '[]'::json) ` +
        `FROM "table_a" AS "S0" WHERE "S0"."relation_2_id" = "R0"."unique_2_id") AS "relations"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare undefined relation (unique to secondary)', async ({ assert }) => {
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
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_c" AS "R0" SET "value" = :0 WHERE "R0"."id_c" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT COALESCE(json_agg(jsonb_build_object('value', "S0"."value")), '[]'::json) ` +
        `FROM "table_a" AS "S0" WHERE "S0"."relation_2_id" = "R0"."unique_2_id") AS "relations"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update relation (unique to secondary)', async ({ assert }) => {
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
        `"Q0" AS (UPDATE ONLY "table_c" SET "value" = :0 WHERE "id_b" = :1 ` +
        `RETURNING "unique_2_id") ` +
        // Relation record
        `UPDATE ONLY "table_a" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."relation_2_id" = "Q0"."unique_2_id"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update and select relation (unique to secondary)', async ({ assert }) => {
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
        `"Q0" AS (UPDATE ONLY "table_c" SET "value" = :0 WHERE "id_b" = :1 RETURNING "id_c", "unique_2_id"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_a" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."relation_2_id" = "Q0"."unique_2_id") ` +
        // Keys of the records to read again
        `SELECT "id_c" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update, connect and select relation (unique to secondary)', async ({ assert }) => {
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
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_c" SET "value" = :0 WHERE "id_c" = :1 RETURNING "id_c", "unique_2_id"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_a" AS "T" SET "relation_2_id" = "Q0"."unique_2_id" FROM "Q0" WHERE "T"."id_a" = :2) ` +
        // Keys of the records to read again
        `SELECT "id_c" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, targetId]);
  });

  it('assert :: prepare update, disconnect and select relation (unique to secondary)', async ({ assert }) => {
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
        id_c: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_c" SET "value" = :0 WHERE "id_c" = :1 RETURNING "id_c", "unique_2_id"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_a" AS "T" SET "relation_2_id" = null FROM "Q0" WHERE "T"."relation_2_id" = "Q0"."unique_2_id") ` +
        // Keys of the records to read again
        `SELECT "id_c" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update and select relation (primary key list untouched)', async ({ assert }) => {
    const repository = TestRelationRepository[tableName];
    const relations = getRelationsWithSchema(tableName, TestRelationRepository);
    const primaryKey = ['id_c'];

    await prepareUpdateQuery(
      new SqlBuilder(),
      tableName,
      repository.schema,
      relations,
      {
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
          id_c: sourceId
        }
      } as Query.UpdateManyInput<any, TestTableMetadata>,
      {
        primaryKey
      }
    );

    // The relation update joins on another column, which must not be added to the table's own key.
    assert.deepEqual(primaryKey, ['id_c']);
  });

  it('assert :: prepare update invalid connection (unique to secondary)', async ({ assert }) => {
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
