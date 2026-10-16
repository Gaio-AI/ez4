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

describe('update secondary relations', () => {
  const tableName = 'table_a';

  const sourceId = '00000000-0000-1000-9000-000000000000';
  const targetId = '00000000-0000-1000-9000-000000000001';

  const prepareRelationUpdate = async <S extends Query.SelectInput<TestTableMetadata>>(
    input: Query.UpdateManyInput<S, TestTableMetadata>
  ) => {
    const repository = TestRelationRepository[tableName];
    const relations = getRelationsWithSchema(tableName, TestRelationRepository);
    const builder = new SqlBuilder();

    const { queries } = await prepareUpdateQuery(builder, tableName, repository.schema, relations, input, {
      primaryKey: ['id_a']
    });

    return builder.with(queries).build();
  };

  it('assert :: prepare empty relation (secondary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_1: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_1: {}
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_a" AS "R0" SET "value" = :0 WHERE "R0"."id_a" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."id_b" = "R0"."relation_1_id" LIMIT 1) AS "relation_1"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare undefined relation (secondary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_1: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_1: {
          id_b: undefined
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_a" AS "R0" SET "value" = :0 WHERE "R0"."id_a" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."id_b" = "R0"."relation_1_id" LIMIT 1) AS "relation_1"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update relation (secondary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      data: {
        value: 'foo',
        relation_1: {
          value: 'bar'
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_a" SET "value" = :0 WHERE "id_a" = :1 ` +
        `RETURNING "relation_1_id") ` +
        // Relation record
        `UPDATE ONLY "table_b" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."id_b" = "Q0"."relation_1_id"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update and select relation (secondary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_1: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_1: {
          value: 'bar'
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_a" SET "value" = :0 WHERE "id_a" = :1 RETURNING "id_a", "relation_1_id"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_b" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."id_b" = "Q0"."relation_1_id") ` +
        // Keys of the records to read again
        `SELECT "id_a" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update, connect and select relation (secondary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_1: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_1: {
          id_b: targetId
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_a" AS "R0" SET "value" = :0, "relation_1_id" = :1 WHERE "R0"."id_a" = :2 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."id_b" = "R0"."relation_1_id" LIMIT 1) AS "relation_1"`
    );

    assert.deepEqual(variables, ['foo', targetId, sourceId]);
  });

  it('assert :: prepare update, disconnect and select relation (secondary to primary)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_1: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_1: {
          id_b: null
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_a" AS "R0" SET "value" = :0, "relation_1_id" = null WHERE "R0"."id_a" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_b" AS "S0" WHERE "S0"."id_b" = "R0"."relation_1_id" LIMIT 1) AS "relation_1"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update invalid connection (secondary to primary)', async ({ assert }) => {
    await assert.rejects(
      () =>
        prepareRelationUpdate({
          data: {
            value: 'foo',
            relation_1: {
              id_b: targetId,

              // Extra fields aren't expected.
              extra: 'foo'
            }
          }
        }),
      MalformedRequestError
    );
  });

  it('assert :: prepare empty relation (secondary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_2: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_2: {}
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_a" AS "R0" SET "value" = :0 WHERE "R0"."id_a" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_c" AS "S0" WHERE "S0"."unique_2_id" = "R0"."relation_2_id" LIMIT 1) AS "relation_2"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare undefined relation (secondary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_2: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_2: {
          id_c: undefined
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_a" AS "R0" SET "value" = :0 WHERE "R0"."id_a" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_c" AS "S0" WHERE "S0"."unique_2_id" = "R0"."relation_2_id" LIMIT 1) AS "relation_2"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update relation (secondary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      data: {
        value: 'foo',
        relation_2: {
          value: 'bar'
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_a" SET "value" = :0 WHERE "id_a" = :1 ` +
        `RETURNING "relation_2_id") ` +
        // Relation record
        `UPDATE ONLY "table_c" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."unique_2_id" = "Q0"."relation_2_id"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update and select relation (secondary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_2: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_2: {
          value: 'bar'
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `WITH ` +
        // Main record
        `"Q0" AS (UPDATE ONLY "table_a" SET "value" = :0 WHERE "id_a" = :1 RETURNING "id_a", "relation_2_id"), ` +
        // Relation record
        `"Q1" AS (UPDATE ONLY "table_c" AS "T" SET "value" = :2 FROM "Q0" WHERE "T"."unique_2_id" = "Q0"."relation_2_id") ` +
        // Keys of the records to read again
        `SELECT "id_a" FROM "Q0"`
    );

    assert.deepEqual(variables, ['foo', sourceId, 'bar']);
  });

  it('assert :: prepare update, connect and select relation (secondary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_2: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_2: {
          unique_2_id: targetId
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_a" AS "R0" SET "value" = :0, "relation_2_id" = :1 WHERE "R0"."id_a" = :2 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_c" AS "S0" WHERE "S0"."unique_2_id" = "R0"."relation_2_id" LIMIT 1) AS "relation_2"`
    );

    assert.deepEqual(variables, ['foo', targetId, sourceId]);
  });

  it('assert :: prepare update, disconnect and select relation (secondary to unique)', async ({ assert }) => {
    const [statement, variables] = await prepareRelationUpdate({
      select: {
        value: true,
        relation_2: {
          value: true
        }
      },
      data: {
        value: 'foo',
        relation_2: {
          unique_2_id: null
        }
      },
      where: {
        id_a: sourceId
      } as any
    });

    assert.equal(
      statement,
      `UPDATE ONLY "table_a" AS "R0" SET "value" = :0, "relation_2_id" = null WHERE "R0"."id_a" = :1 ` +
        // Return
        `RETURNING "R0"."value", (SELECT jsonb_build_object('value', "S0"."value") ` +
        `FROM "table_c" AS "S0" WHERE "S0"."unique_2_id" = "R0"."relation_2_id" LIMIT 1) AS "relation_2"`
    );

    assert.deepEqual(variables, ['foo', sourceId]);
  });

  it('assert :: prepare update invalid connection (secondary to unique)', async ({ assert }) => {
    await assert.rejects(
      () =>
        prepareRelationUpdate({
          data: {
            value: 'foo',
            relation_2: {
              unique_2_id: targetId,

              // Extra fields aren't expected.
              extra: 'foo'
            }
          }
        }),
      MalformedRequestError
    );
  });
});
