import { beforeEach, describe, it } from 'node:test';
import { equal } from 'node:assert/strict';

import { SqlBuilder } from '@ez4/pgsql';

describe('sql table primary constraint tests', () => {
  let sql: SqlBuilder;

  beforeEach(() => {
    sql = new SqlBuilder();
  });

  it('assert :: add primary constraint', () => {
    const query = sql.table('table').alter();

    query.constraint('foo').primary(['bar', 'baz']);

    const statement = query.build();

    equal(statement, `ALTER TABLE "table" ADD CONSTRAINT "foo" PRIMARY KEY ("bar", "baz")`);
  });

  it('assert :: add primary constraint (change columns)', () => {
    const query = sql.table('table').alter();

    const constraint = query.constraint('foo').primary(['bar', 'baz']);

    constraint.columns(['bar', 'qux']);

    const statement = query.build();

    equal(statement, `ALTER TABLE "table" ADD CONSTRAINT "foo" PRIMARY KEY ("bar", "qux")`);
  });

  it('assert :: add primary constraint (using index)', () => {
    const query = sql.table('table').alter();

    query.constraint('foo').primary(['bar', 'baz']).index('foo_index');

    const statement = query.build();

    equal(statement, `ALTER TABLE "table" ADD CONSTRAINT "foo" PRIMARY KEY USING INDEX "foo_index"`);
  });

  it('assert :: replace primary constraint (using index)', () => {
    const query = sql.table('table').alter().existing();

    query.constraint('foo').drop().existing();
    query.constraint('bar').primary(['baz']).index('bar_index');

    const statement = query.build();

    equal(
      statement,
      `ALTER TABLE IF EXISTS "table" DROP CONSTRAINT IF EXISTS "foo", ADD CONSTRAINT "bar" PRIMARY KEY USING INDEX "bar_index"`
    );
  });
});
