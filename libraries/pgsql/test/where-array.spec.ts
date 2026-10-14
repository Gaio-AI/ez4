import type { ObjectSchema } from '@ez4/schema';

import { describe, it, mock } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { SchemaType } from '@ez4/schema';
import { SqlBuilder } from '@ez4/pgsql';

describe('sql where array variable tests', () => {
  const schema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      foo: {
        type: SchemaType.String,
        format: 'uuid'
      },
      bar: {
        type: SchemaType.Object,
        properties: {
          baz: {
            type: SchemaType.String
          }
        }
      }
    }
  };

  const makeBuilder = (onPrepareArray: (values: unknown[], context: { index: number }) => unknown) => {
    return new SqlBuilder({
      onPrepareVariable: (value, { index }) => `variable_${index}_${value}`,
      onPrepareArray
    });
  };

  it('assert :: where is in (one array variable)', () => {
    const onPrepareArray = mock.fn((values: unknown[], { index }: { index: number }) => `array_${index}_${values.join('|')}`);

    const [statement, variables] = makeBuilder(onPrepareArray)
      .select(schema)
      .from('test')
      .where({ foo: { isIn: ['a', 'b', 'c'] } })
      .build();

    equal(statement, `SELECT FROM "test" WHERE "foo" = ANY(:0)`);

    deepEqual(variables, ['array_0_a|b|c']);

    equal(onPrepareArray.mock.callCount(), 1);
    deepEqual(onPrepareArray.mock.calls[0].arguments[1], { index: 0, schema: schema.properties.foo });
  });

  it('assert :: where is in (array variable keeps the variable order)', () => {
    const onPrepareArray = mock.fn((values: unknown[], { index }: { index: number }) => `array_${index}_${values.join('|')}`);

    const [statement, variables] = makeBuilder(onPrepareArray)
      .select(schema)
      .from('test')
      .where({ bar: { baz: 'x' }, foo: { isIn: ['a', 'b'] } })
      .build();

    equal(statement, `SELECT FROM "test" WHERE "bar"->>'baz' = :0 AND "foo" = ANY(:1)`);

    deepEqual(variables, ['variable_0_x', 'array_1_a|b']);
  });

  it('assert :: where is in (array refused by the driver)', () => {
    const onPrepareArray = mock.fn(() => undefined);

    const [statement, variables] = makeBuilder(onPrepareArray)
      .select(schema)
      .from('test')
      .where({ foo: { isIn: ['a', 'b'] } })
      .build();

    equal(statement, `SELECT FROM "test" WHERE "foo" IN (:0, :1)`);

    deepEqual(variables, ['variable_0_a', 'variable_1_b']);
  });

  it('assert :: where is in (insensitive array variable)', () => {
    const [statement, variables] = makeBuilder((values) => values)
      .select(schema)
      .from('test')
      .where({ foo: { insensitive: true, isIn: ['a', 'b'] } })
      .build();

    equal(statement, `SELECT FROM "test" WHERE LOWER("foo") = ANY(:0)`);

    deepEqual(variables, [['a', 'b']]);
  });

  it('assert :: where is in (raw values are not an array variable)', () => {
    const sql = makeBuilder((values) => values);

    const [statement, variables] = sql
      .select(schema)
      .from('test')
      .where({ foo: { isIn: ['a', sql.rawValue('gen_random_uuid()')] } })
      .build();

    equal(statement, `SELECT FROM "test" WHERE "foo" IN (:0, gen_random_uuid())`);

    deepEqual(variables, ['variable_0_a']);
  });

  it('assert :: where is in (empty list)', () => {
    const onPrepareArray = mock.fn((values: unknown[]) => values);

    const [statement, variables] = makeBuilder(onPrepareArray)
      .select(schema)
      .from('test')
      .where({ foo: { isIn: [] } })
      .build();

    equal(statement, `SELECT FROM "test" WHERE false`);

    deepEqual(variables, []);

    equal(onPrepareArray.mock.callCount(), 0);
  });

  it('assert :: where is in (without a preparer every value is its own variable)', () => {
    const sql = new SqlBuilder({
      onPrepareVariable: (value, { index }) => `variable_${index}_${value}`
    });

    const [statement, variables] = sql
      .select(schema)
      .from('test')
      .where({ foo: { isIn: ['a', 'b'] } })
      .build();

    equal(statement, `SELECT FROM "test" WHERE "foo" IN (:0, :1)`);

    deepEqual(variables, ['variable_0_a', 'variable_1_b']);
  });
});
