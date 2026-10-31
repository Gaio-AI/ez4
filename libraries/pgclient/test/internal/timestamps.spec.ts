import type { ObjectSchema } from '@ez4/schema';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getRelationsWithSchema } from '../../src/service/relations';
import { getInsertSchema, getTimestampColumns, omitTimestamps } from '../../src/utils/timestamps';

import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('timestamps utils', () => {
  const timestamps = {
    created: 'created_at',
    updated: 'updated_at'
  };

  const schema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      id: {
        type: SchemaType.String
      },
      created_at: {
        type: SchemaType.String,
        format: 'date-time'
      },
      updated_at: {
        type: SchemaType.String,
        format: 'date-time',
        definitions: {
          default: '2026-01-01T00:00:00.000Z'
        }
      }
    }
  };

  it('assert :: timestamp columns', () => {
    deepEqual(getTimestampColumns(timestamps), ['created_at', 'updated_at']);
    deepEqual(getTimestampColumns({ updated: 'updated_at' }), ['updated_at']);
    deepEqual(getTimestampColumns(undefined), []);
  });

  it('assert :: insert schema', () => {
    // The timestamps are optional, and the database writes the one left out instead of the schema default.
    deepEqual(getInsertSchema(schema, timestamps), {
      type: SchemaType.Object,
      properties: {
        id: {
          type: SchemaType.String
        },
        created_at: {
          type: SchemaType.String,
          format: 'date-time',
          optional: true
        },
        updated_at: {
          type: SchemaType.String,
          format: 'date-time',
          optional: true,
          definitions: {}
        }
      }
    });

    // A table without timestamps inserts with its own schema.
    equal(getInsertSchema(schema, undefined), schema);
  });

  it('assert :: data without the timestamps', () => {
    const data = { id: 'abc', created_at: 'foo', updated_at: 'bar' };

    deepEqual(omitTimestamps(data, timestamps), { id: 'abc' });

    equal(omitTimestamps(data, undefined), data);
  });

  it('assert :: related table with timestamps', () => {
    const relations = getRelationsWithSchema('table_a', {
      table_a: {
        name: 'table_a',
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            b_id: { type: SchemaType.String }
          }
        },
        indexes: {
          id: { name: 'id', columns: ['id'], type: Index.Primary }
        },
        relations: {
          relation_b: {
            sourceTable: 'table_b',
            sourceColumn: 'id',
            sourceIndex: Index.Primary,
            targetColumn: 'b_id'
          }
        }
      },
      table_b: {
        name: 'table_b',
        timestamps,
        schema,
        indexes: {
          id: { name: 'id', columns: ['id'], type: Index.Primary }
        },
        relations: {}
      }
    });

    const { sourceSchema, sourceTimestamps } = relations['table_a.relation_b'];

    deepEqual(sourceSchema, getInsertSchema(schema, timestamps));
    deepEqual(sourceTimestamps, timestamps);
  });
});
