import { beforeEach, describe, it } from 'node:test';
import { equal, deepEqual } from 'node:assert/strict';

import { SqlBuilder } from '@ez4/pgsql';
import { Order } from '@ez4/database';

describe('sql select aggregate tests', () => {
  let sql: SqlBuilder;

  beforeEach(() => {
    sql = new SqlBuilder();
  });

  it('assert :: select count all', () => {
    const query = sql.select().from('table').aggregateColumn({
      function: 'count',
      alias: 'total'
    });

    const [statement, variables] = query.build();

    deepEqual(variables, []);

    equal(statement, 'SELECT COUNT(*) AS "total" FROM "table"');
  });

  it('assert :: select aggregate columns', () => {
    const query = sql
      .select()
      .from('table')
      .aggregateColumn({ function: 'count', column: 'foo', alias: 'foo_count' })
      .aggregateColumn({ function: 'count', column: 'foo', distinct: true, alias: 'foo_distinct' })
      .aggregateColumn({ function: 'sum', column: 'bar', alias: 'bar_sum' })
      .aggregateColumn({ function: 'min', column: 'bar', alias: 'bar_min' })
      .aggregateColumn({ function: 'max', column: 'bar', alias: 'bar_max' });

    const [statement, variables] = query.build();

    deepEqual(variables, []);

    equal(
      statement,
      'SELECT COUNT("foo") AS "foo_count", COUNT(DISTINCT "foo") AS "foo_distinct", SUM("bar") AS "bar_sum", ' +
        'MIN("bar") AS "bar_min", MAX("bar") AS "bar_max" FROM "table"'
    );
  });

  it('assert :: select aggregate with filters', () => {
    const query = sql
      .select()
      .from('table')
      .where({ baz: 'abc' })
      .aggregateColumn({ function: 'count', alias: 'total' })
      .aggregateColumn({ function: 'sum', column: 'bar', filters: { foo: 'def', bar: { gt: 1 } }, alias: 'bar_sum' });

    const [statement, variables] = query.build();

    deepEqual(variables, ['def', 1, 'abc']);

    equal(
      statement,
      `SELECT COUNT(*) AS "total", SUM("bar") FILTER (WHERE "foo" = :0 AND "bar" > :1) AS "bar_sum" FROM "table" WHERE "baz" = :2`
    );
  });

  it('assert :: select aggregate with format', () => {
    const query = sql
      .select()
      .from('table')
      .aggregateColumn({
        function: 'max',
        column: 'foo',
        filters: { bar: true },
        format: (expression) => `to_char(${expression}, 'YYYY')`,
        alias: 'last'
      });

    const [statement, variables] = query.build();

    deepEqual(variables, [true]);

    equal(statement, `SELECT to_char(MAX("foo") FILTER (WHERE "bar" = :0), 'YYYY') AS "last" FROM "table"`);
  });

  it('assert :: select aggregate grouped and ordered by alias', () => {
    const query = sql
      .select()
      .from('table')
      .as('alias')
      .column('foo')
      .aggregateColumn({ function: 'count', alias: 'total' })
      .aggregateColumn({ function: 'max', column: 'bar', alias: 'last' })
      .group('foo')
      .order({
        total: Order.Desc,
        foo: Order.Asc
      })
      .take(10);

    const [statement, variables] = query.build();

    deepEqual(variables, []);

    equal(
      statement,
      'SELECT "alias"."foo", COUNT(*) AS "total", MAX("alias"."bar") AS "last" FROM "table" AS "alias" ' +
        'GROUP BY "alias"."foo" ORDER BY "total" DESC, "alias"."foo" ASC LIMIT 10'
    );
  });
});
