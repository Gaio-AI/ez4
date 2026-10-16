import type { RelationMetadata, Index, Query } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';
import type { ObjectSchema } from '@ez4/schema';

import { equal, deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';
import { SqlBuilder } from '@ez4/pgsql';

import { prepareDeleteQuery } from '../../src/queries/delete';

type TestTableMetadata = {
  engine: PostgresEngine;
  relations: RelationMetadata;
  indexes: {
    id: Index.Primary;
  };
  schema: {
    id: string;
    foo?: number;
    bar?: boolean;
  };
};

describe('delete query', () => {
  const tableName = 'ez4-test-delete';

  const testSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      id: {
        type: SchemaType.String,
        format: 'uuid'
      },
      foo: {
        type: SchemaType.Number,
        optional: true
      },
      bar: {
        type: SchemaType.Boolean,
        optional: true
      }
    }
  };

  const prepareDelete = <S extends Query.SelectInput<TestTableMetadata>>(
    input: Query.DeleteOneInput<S, TestTableMetadata> | Query.DeleteManyInput<S, TestTableMetadata>
  ) => {
    const builder = new SqlBuilder();

    const { queries } = prepareDeleteQuery(builder, tableName, testSchema, {}, input, {
      primaryKey: ['id']
    });

    return builder.with(queries).build();
  };

  it('assert :: prepare delete (take)', () => {
    const [statement, variables] = prepareDelete({
      where: {
        foo: 123
      },
      take: 5
    });

    equal(
      statement,
      `WITH ` +
        // Page of keys
        `"Q0" AS (SELECT "R0"."id" AS "__EZ4_KEY_0" FROM "ez4-test-delete" AS "R0" WHERE "R0"."foo" = :0 LIMIT 5) ` +
        // Records of the page that still match
        `DELETE FROM "ez4-test-delete" AS "R1" WHERE ("R1"."foo" = :1 AND EXISTS (SELECT 1 FROM "Q0" WHERE "__EZ4_KEY_0" = "R1"."id"))`
    );

    deepEqual(variables, [123, 123]);
  });

  it('assert :: prepare delete', () => {
    const [statement, variables] = prepareDelete({
      where: {
        id: '00000000-0000-1000-9000-000000000000'
      }
    });

    equal(statement, `DELETE FROM "ez4-test-delete" WHERE "id" = :0`);

    deepEqual(variables, ['00000000-0000-1000-9000-000000000000']);
  });

  it('assert :: prepare delete (with select)', () => {
    const [statement, variables] = prepareDelete({
      select: {
        id: true,
        foo: true,
        bar: true
      },
      where: {
        id: '00000000-0000-1000-9000-000000000000'
      }
    });

    equal(statement, `DELETE FROM "ez4-test-delete" WHERE "id" = :0 RETURNING "id", "foo", "bar"`);

    deepEqual(variables, ['00000000-0000-1000-9000-000000000000']);
  });
});
