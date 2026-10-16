import type { ObjectSchema } from '@ez4/schema';

import { beforeEach, describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';
import { SqlBuilder } from '@ez4/pgsql';

describe('sql where multiple operators tests', () => {
  let sql: SqlBuilder;

  const schema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      total: {
        type: SchemaType.Number,
        format: 'integer'
      },
      created_at: {
        type: SchemaType.String,
        format: 'date-time'
      },
      name: {
        type: SchemaType.String
      },
      json: {
        type: SchemaType.Object,
        properties: {
          foo: {
            type: SchemaType.String,
            nullable: true,
            optional: true
          }
        }
      }
    }
  };

  beforeEach(() => {
    sql = new SqlBuilder();
  });

  it('assert :: where multiple operators (integer column)', ({ assert }) => {
    const query = sql
      .select(schema)
      .from('test')
      .where({
        total: {
          gte: 1,
          lt: 5
        }
      });

    const [statement, variables] = query.build();

    assert.deepEqual(variables, [1, 5]);

    assert.equal(statement, `SELECT FROM "test" WHERE ("total" >= :0 AND "total" < :1)`);
  });

  it('assert :: where multiple operators (date-time column)', ({ assert }) => {
    const query = sql
      .select(schema)
      .from('test')
      .where({
        created_at: {
          gte: '2026-01-01T00:00:00.000Z',
          lt: '2026-02-01T00:00:00.000Z'
        }
      });

    const [statement, variables] = query.build();

    assert.deepEqual(variables, ['2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z']);

    assert.equal(statement, `SELECT FROM "test" WHERE ("created_at" >= :0 AND "created_at" < :1)`);
  });

  it('assert :: where multiple operators (with insensitive)', ({ assert }) => {
    const query = sql
      .select(schema)
      .from('test')
      .where({
        name: {
          startsWith: 'abc',
          contains: 'def',
          insensitive: true
        }
      });

    const [statement, variables] = query.build();

    assert.deepEqual(variables, ['abc', 'def']);

    assert.equal(statement, `SELECT FROM "test" WHERE ("name" ILIKE :0 || '%' AND "name" ILIKE '%' || :1 || '%')`);
  });

  it('assert :: where multiple operators (json field with is missing)', ({ assert }) => {
    const query = sql
      .select(schema)
      .from('test')
      .where({
        json: {
          foo: {
            isMissing: false,
            not: 'abc'
          }
        }
      });

    const [statement, variables] = query.build();

    assert.deepEqual(variables, ['abc']);

    assert.equal(statement, `SELECT FROM "test" WHERE ("json" ? 'foo' AND "json"->>'foo' != :0)`);
  });
});
