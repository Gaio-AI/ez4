import type { MigrationRelationError } from '@ez4/pgmigration/library';
import type { TableRelation } from '@ez4/database/library';
import type { AnySchema } from '@ez4/schema';

import { describe, it } from 'node:test';
import { equal, throws } from 'assert/strict';

import { getTableRepository } from '@ez4/pgclient/library';
import { validateRepository } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: validate relation tests', () => {
  const getRepository = (relation: Partial<TableRelation>, targetSchema: AnySchema = { type: SchemaType.String, format: 'uuid' }) => {
    return getTableRepository([
      {
        name: 'table_a',
        indexes: [],
        relations: [
          {
            sourceTable: 'table_b',
            sourceColumn: 'id',
            sourceIndex: Index.Primary,
            targetAlias: 'relation',
            targetColumn: 'b_id',
            targetIndex: Index.Secondary,
            ...relation
          }
        ],
        schema: {
          type: SchemaType.Object,
          properties: {
            b_id: targetSchema
          }
        }
      },
      {
        name: 'table_b',
        indexes: [],
        schema: {
          type: SchemaType.Object,
          properties: {
            id: {
              type: SchemaType.String,
              format: 'uuid'
            },
            code: {
              type: SchemaType.String
            }
          }
        }
      }
    ]);
  };

  const assertRelationError = (relation: Partial<TableRelation>, message: string, targetSchema?: AnySchema) => {
    throws(
      () => validateRepository(getRepository(relation, targetSchema)),
      (error: MigrationRelationError) => {
        equal(error.message, message);
        return true;
      }
    );
  };

  it('assert :: valid relation', () => {
    validateRepository(getRepository({ onDelete: 'restrict' }));
  });

  it('assert :: foreign key to a column that is not a key', () => {
    assertRelationError(
      { sourceColumn: 'code', sourceIndex: Index.Secondary, foreignKey: true },
      `Relation table_a.relation references code, which isn't a primary or unique key.`,
      { type: SchemaType.String }
    );
  });

  it('assert :: delete action of a relation without foreign key', () => {
    assertRelationError({ foreignKey: false, onDelete: 'cascade' }, 'Relation table_a.relation has a delete action but no foreign key.');
  });

  it('assert :: delete action that sets a required column to null', () => {
    assertRelationError({ onDelete: 'set null' }, `Relation table_a.relation sets b_id to null, which doesn't take null.`);
  });

  it('assert :: foreign key of another type', () => {
    assertRelationError({}, 'Relation table_a.relation holds a key of another type than id.', { type: SchemaType.String });
  });

  it('assert :: foreign key between a string and a bounded string', () => {
    validateRepository(
      getRepository({ sourceColumn: 'code', sourceIndex: Index.Unique }, { type: SchemaType.String, definitions: { maxLength: 10 } })
    );
  });
});
