import type { IndexedTables, RelationTables } from '@ez4/database/library';
import type { Database, Query } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';

import { describe, it } from 'node:test';

import { Index, Order } from '@ez4/database';
import { SchemaType } from '@ez4/schema';
import { SqlBuilder } from '@ez4/pgsql';

import { getRelationsWithSchema } from '../../src/service/relations';
import { getTableRepository } from '../../src/utils/repository';
import { prepareSelectQuery } from '../../src/queries/select';

declare class Test extends Database.Service<PostgresEngine> {
  tables: [
    {
      name: 'ez4-test-cursor';
      indexes: {
        id: Index.Primary;
        parent_id: Index.Secondary;
      };
      relations: {
        'id@children': 'ez4-test-cursor:parent_id';
      };
      schema: {
        id: string;
        parent_id?: string;
        category: number;
        created_at: string;
      };
    }
  ];
}

type TestTableMetadata = {
  schema: Test['tables'][0]['schema'];
  indexes: IndexedTables<Test>['ez4-test-cursor'];
  relations: RelationTables<Test>['ez4-test-cursor'];
  engine: Test['engine'];
};

describe('select cursor', () => {
  const tableName = 'ez4-test-cursor';

  const repository = getTableRepository([
    {
      name: tableName,
      indexes: [
        {
          name: 'id',
          columns: ['id'],
          type: Index.Primary
        }
      ],
      relations: [
        {
          targetAlias: 'children',
          targetColumn: 'id',
          targetIndex: Index.Primary,
          sourceTable: tableName,
          sourceColumn: 'parent_id'
        }
      ],
      schema: {
        type: SchemaType.Object,
        properties: {
          id: {
            type: SchemaType.String,
            format: 'uuid'
          },
          parent_id: {
            type: SchemaType.String,
            format: 'uuid',
            optional: true
          },
          category: {
            type: SchemaType.Number,
            format: 'integer'
          },
          created_at: {
            type: SchemaType.String,
            format: 'date-time'
          }
        }
      }
    }
  ]);

  const prepareSelect = <S extends Query.SelectInput<TestTableMetadata>>(input: Query.FindManyInput<S, false, TestTableMetadata>) => {
    const builder = new SqlBuilder();

    const relations = getRelationsWithSchema(tableName, repository);

    const { query } = prepareSelectQuery(builder, tableName, repository[tableName].schema, relations, input, {
      primaryColumns: ['id']
    });

    return query.build();
  };

  const encodeCursor = (entries: [string, string][]) => {
    return Buffer.from(JSON.stringify(entries)).toString('base64url');
  };

  it('assert :: prepare select cursor (page with tiebreak)', ({ assert }) => {
    const [statement, variables] = prepareSelect({
      select: {
        id: true
      },
      order: {
        created_at: Order.Desc
      },
      take: 7
    });

    assert.equal(
      statement,
      `SELECT "R0"."id", ` +
        `to_char("R0"."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "__EZ4_CURSOR_0", ` +
        `"R0"."id"::text AS "__EZ4_CURSOR_1" ` +
        `FROM "ez4-test-cursor" AS "R0" ` +
        `ORDER BY "R0"."created_at" DESC, "R0"."id" DESC ` +
        `LIMIT 8`
    );

    assert.deepEqual(variables, []);
  });

  it('assert :: prepare select cursor (offset page with tiebreak)', ({ assert }) => {
    const [statement, variables] = prepareSelect({
      select: {
        id: true
      },
      order: {
        category: Order.Asc
      },
      skip: 14
    });

    assert.equal(statement, `SELECT "R0"."id" FROM "ez4-test-cursor" AS "R0" ORDER BY "R0"."category" ASC, "R0"."id" ASC OFFSET 14`);

    assert.deepEqual(variables, []);
  });

  it('assert :: prepare select cursor (same directions)', ({ assert }) => {
    const [statement, variables] = prepareSelect({
      select: {
        id: true
      },
      where: {
        category: 1
      },
      order: {
        created_at: Order.Desc
      },
      cursor: encodeCursor([
        ['created_at', '2024-01-01T00:00:12.123456Z'],
        ['id', '00000000-0000-1000-9000-000000000000']
      ]),
      take: 7
    });

    assert.equal(
      statement,
      `SELECT "R0"."id", ` +
        `to_char("R0"."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "__EZ4_CURSOR_0", ` +
        `"R0"."id"::text AS "__EZ4_CURSOR_1" ` +
        `FROM "ez4-test-cursor" AS "R0" ` +
        `WHERE "R0"."category" = :0 ` +
        `AND ((("R0"."created_at", "R0"."id") < (CAST(:1 AS timestamptz), CAST(:2 AS uuid)))) ` +
        `ORDER BY "R0"."created_at" DESC, "R0"."id" DESC ` +
        `LIMIT 8`
    );

    assert.deepEqual(variables, [1, '2024-01-01T00:00:12.123456Z', '00000000-0000-1000-9000-000000000000']);
  });

  it('assert :: prepare select cursor (mixed directions)', ({ assert }) => {
    const [statement, variables] = prepareSelect({
      select: {
        id: true
      },
      order: {
        category: Order.Asc,
        created_at: Order.Desc
      },
      cursor: encodeCursor([
        ['category', '2'],
        ['created_at', '2024-01-01T00:00:12.123456Z'],
        ['id', '00000000-0000-1000-9000-000000000000']
      ]),
      skip: 7
    });

    assert.equal(
      statement,
      `SELECT "R0"."id" FROM "ez4-test-cursor" AS "R0" ` +
        `WHERE (("R0"."category" >= CAST(:0 AS bigint) AND ` +
        `("R0"."category" > CAST(:0 AS bigint) ` +
        `OR ("R0"."category" = CAST(:0 AS bigint) AND "R0"."created_at" < CAST(:1 AS timestamptz)) ` +
        `OR ("R0"."category" = CAST(:0 AS bigint) AND "R0"."created_at" = CAST(:1 AS timestamptz) AND "R0"."id" < CAST(:2 AS uuid))))) ` +
        `ORDER BY "R0"."category" ASC, "R0"."created_at" DESC, "R0"."id" DESC ` +
        `OFFSET 7`
    );

    assert.deepEqual(variables, ['2', '2024-01-01T00:00:12.123456Z', '00000000-0000-1000-9000-000000000000']);
  });

  it('assert :: prepare select cursor (mixed directions after leading columns)', ({ assert }) => {
    const [statement, variables] = prepareSelect({
      select: {
        id: true
      },
      order: {
        category: Order.Asc,
        created_at: Order.Asc,
        id: Order.Desc
      },
      cursor: encodeCursor([
        ['category', '2'],
        ['created_at', '2024-01-01T00:00:12.123456Z'],
        ['id', '00000000-0000-1000-9000-000000000000']
      ])
    });

    assert.equal(
      statement,
      `SELECT "R0"."id" FROM "ez4-test-cursor" AS "R0" ` +
        `WHERE ((("R0"."category", "R0"."created_at") >= (CAST(:0 AS bigint), CAST(:1 AS timestamptz)) AND ` +
        `("R0"."category" > CAST(:0 AS bigint) ` +
        `OR ("R0"."category" = CAST(:0 AS bigint) AND "R0"."created_at" > CAST(:1 AS timestamptz)) ` +
        `OR ("R0"."category" = CAST(:0 AS bigint) AND "R0"."created_at" = CAST(:1 AS timestamptz) AND "R0"."id" < CAST(:2 AS uuid))))) ` +
        `ORDER BY "R0"."category" ASC, "R0"."created_at" ASC, "R0"."id" DESC`
    );

    assert.deepEqual(variables, ['2', '2024-01-01T00:00:12.123456Z', '00000000-0000-1000-9000-000000000000']);
  });

  it('assert :: prepare select cursor (include page with tiebreak)', ({ assert }) => {
    const [statement, variables] = prepareSelect({
      select: {
        children: {
          id: true
        }
      },
      include: {
        children: {
          order: {
            category: Order.Desc
          },
          take: 3
        }
      }
    });

    assert.equal(
      statement,
      `SELECT ` +
        `(SELECT COALESCE(json_agg(jsonb_build_object('id', "id") ORDER BY "category" DESC, "id" DESC), '[]'::json) ` +
        /**/ `FROM (` +
        /****/ `SELECT "S0"."id", "S0"."category" FROM "ez4-test-cursor" AS "S0" ` +
        /****/ `WHERE "S0"."parent_id" = "R0"."id" ` +
        /****/ `ORDER BY "S0"."category" DESC, "S0"."id" DESC ` +
        /****/ `LIMIT 3` +
        /**/ `) AS "S0"` +
        `) AS "children" ` +
        `FROM "ez4-test-cursor" AS "R0"`
    );

    assert.deepEqual(variables, []);
  });
});
