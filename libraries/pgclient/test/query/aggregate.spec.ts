import type { PgAggregateInput } from '../../src/queries/aggregate';

import { describe, it } from 'node:test';

import { Index, Order } from '@ez4/database';
import { SchemaType } from '@ez4/schema';
import { SqlBuilder } from '@ez4/pgsql';

import { getRelationsWithSchema } from '../../src/service/relations';
import { getTableRepository } from '../../src/utils/repository';
import { prepareAggregateQuery } from '../../src/queries/aggregate';

describe('aggregate query', () => {
  const tableName = 'ez4_test_table';

  const repository = getTableRepository([
    {
      name: tableName,
      indexes: [],
      relations: [
        {
          targetAlias: 'parent',
          targetColumn: 'parent_id',
          targetIndex: Index.Secondary,
          sourceIndex: Index.Primary,
          sourceTable: tableName,
          sourceColumn: 'id'
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
            optional: true,
            format: 'uuid'
          },
          status: {
            type: SchemaType.String
          },
          amount: {
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

  const prepareAggregate = (input: PgAggregateInput) => {
    const builder = new SqlBuilder();

    const relations = getRelationsWithSchema(tableName, repository);
    const table = repository[tableName];

    const { query, columns } = prepareAggregateQuery(builder, tableName, table.schema, relations, input);

    return [...query.build(), columns];
  };

  it('assert :: prepare aggregate without group', ({ assert }) => {
    const [statement, variables, columns] = prepareAggregate({
      select: {
        total: { count: true },
        amount: { sum: 'amount' },
        last: { max: 'created_at' }
      },
      where: {
        status: 'live'
      }
    });

    assert.equal(
      statement,
      `SELECT COUNT(*) AS "total", SUM("amount") AS "amount", ` +
        `to_char(MAX("created_at"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "last" ` +
        `FROM "ez4_test_table" WHERE "status" = :0`
    );

    assert.deepEqual(variables, ['live']);
    assert.deepEqual(columns, ['total', 'amount', 'last']);
  });

  it('assert :: prepare aggregate with group, filter and order', ({ assert }) => {
    const [statement, variables, columns] = prepareAggregate({
      by: ['parent_id', 'created_at'],
      select: {
        total: { count: true },
        parents: { count: 'parent_id', distinct: true },
        live: { count: true, where: { status: 'live' } },
        first: { min: 'created_at', where: { amount: { gt: 0 } } }
      },
      where: {
        amount: { gte: 10 }
      },
      order: {
        total: Order.Desc,
        created_at: Order.Asc
      },
      skip: 5,
      take: 10
    });

    assert.equal(
      statement,
      `SELECT "parent_id", to_char("created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "created_at", ` +
        `COUNT(*) AS "total", COUNT(DISTINCT "parent_id") AS "parents", ` +
        `COUNT(*) FILTER (WHERE "status" = :0) AS "live", ` +
        `to_char(MIN("created_at") FILTER (WHERE "amount" > :1), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "first" ` +
        `FROM "ez4_test_table" WHERE "amount" >= :2 ` +
        `GROUP BY "parent_id", "created_at" ` +
        `ORDER BY "total" DESC, "created_at" ASC OFFSET 5 LIMIT 10`
    );

    assert.deepEqual(variables, ['live', 0, 10]);
    assert.deepEqual(columns, ['parent_id', 'created_at', 'total', 'parents', 'live', 'first']);
  });

  it('assert :: prepare aggregate with relation filters', ({ assert }) => {
    const [statement, variables] = prepareAggregate({
      by: ['status'],
      select: {
        total: { count: true },
        orphans: { count: true, where: { parent: null } }
      },
      where: {
        parent: {
          status: 'live'
        }
      },
      order: {
        total: Order.Desc,
        status: Order.Asc
      }
    });

    assert.equal(
      statement,
      `SELECT "R0"."status", COUNT(*) AS "total", ` +
        `COUNT(*) FILTER (WHERE (NOT EXISTS (SELECT 1 FROM "ez4_test_table" AS "T0" WHERE "T0"."id" = "R0"."parent_id"))) AS "orphans" ` +
        `FROM "ez4_test_table" AS "R0" ` +
        `WHERE EXISTS (SELECT 1 FROM "ez4_test_table" AS "T1" WHERE "T1"."status" = :0 AND "T1"."id" = "R0"."parent_id") ` +
        `GROUP BY "R0"."status" ORDER BY "total" DESC, "R0"."status" ASC`
    );

    assert.deepEqual(variables, ['live']);
  });

  it('assert :: prepare aggregate with an alias equal to a group column', ({ assert }) => {
    assert.throws(
      () =>
        prepareAggregate({
          by: ['status'],
          select: {
            status: { count: true }
          }
        }),
      {
        message: `Aggregate alias 'status' is also a group column.`
      }
    );
  });

  it('assert :: prepare aggregate with invalid fields', ({ assert }) => {
    assert.throws(() => prepareAggregate({ select: { total: { count: true, sum: 'amount' } } }), {
      message: `Aggregate alias 'total' must have exactly one of count (true or a column), sum, min or max (a column).`
    });

    assert.throws(() => prepareAggregate({ select: { total: { sum: true as unknown as string } } }), {
      message: `Aggregate alias 'total' must have exactly one of count (true or a column), sum, min or max (a column).`
    });

    assert.throws(() => prepareAggregate({ select: { total: { sum: 'status' } } }), {
      message: `Aggregate alias 'total' can't aggregate the column 'status'.`
    });

    assert.throws(() => prepareAggregate({ select: { first: { min: 'id' } } }), {
      message: `Aggregate alias 'first' can't aggregate the column 'id'.`
    });

    assert.throws(() => prepareAggregate({ select: { total: { sum: 'missing' } } }), {
      message: `Schema for field 'ez4_test_table.missing' is missing.`
    });

    assert.throws(() => prepareAggregate({ select: {} }), {
      message: `Aggregate query must have a group column or an aggregate.`
    });
  });
});
