import type { Query, RelationMetadata } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';
import type { ObjectSchema } from '@ez4/schema';

import { describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';
import { SqlBuilder } from '@ez4/pgsql';

import { prepareUpdateQuery } from '../../src/queries/update';

type TestTableMetadata = {
  engine: PostgresEngine;
  relations: RelationMetadata;
  indexes: {};
  schema: {};
};

describe('update schema', () => {
  const tableName = 'ez4-test-update-schema';

  const prepareUpdate = async <S extends Query.SelectInput<TestTableMetadata>>(
    schema: ObjectSchema,
    input: Query.UpdateManyInput<S, TestTableMetadata>
  ) => {
    const builder = new SqlBuilder();

    const { queries } = await prepareUpdateQuery(builder, tableName, schema, {}, input);

    return builder.with(queries).build();
  };

  it('assert :: prepare update schema (with select)', async ({ assert }) => {
    const [statement, variables] = await prepareUpdate(
      {
        type: SchemaType.Object,
        properties: {
          scalar: {
            type: SchemaType.String,
            optional: true
          },
          json: {
            type: SchemaType.Object,
            properties: {
              scalar: {
                type: SchemaType.Number
              }
            }
          }
        }
      },
      {
        select: {
          scalar: true,
          json: {
            scalar: true
          }
        },
        data: {
          scalar: 'foo',
          json: {
            scalar: 123
          }
        }
      }
    );

    assert.equal(
      statement,
      `UPDATE ONLY "ez4-test-update-schema" SET "scalar" = :0, "json"[:1] = :2 ` +
        // Return
        `RETURNING "scalar", jsonb_build_object('scalar', "json"['scalar']) AS "json"`
    );

    assert.deepEqual(variables, ['foo', 'scalar', 123]);
  });
});
