import type { TableIndex } from '@ez4/database/library';

import { describe, it } from 'node:test';
import { deepEqual } from 'assert/strict';

import { getTableRepository } from '@ez4/pgclient/library';
import { getUnindexedForeignKeys } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: unindexed foreign key tests', () => {
  const getRepository = (indexes: TableIndex[], withRelation = true) => {
    return getTableRepository([
      {
        name: 'table_a',
        indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }, ...indexes],
        relations: withRelation
          ? [
              {
                sourceTable: 'table_b',
                sourceColumn: 'id',
                sourceIndex: Index.Primary,
                targetAlias: 'relation',
                targetColumn: 'b_id',
                targetIndex: indexes.find(({ name }) => name === 'b_id')?.type
              }
            ]
          : [],
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            b_id: { type: SchemaType.String },
            created_at: { type: SchemaType.String }
          }
        }
      },
      {
        name: 'table_b',
        indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }],
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String }
          }
        }
      }
    ]);
  };

  const unindexedKey = [{ table: 'table_a', column: 'b_id', sourceTable: 'table_b' }];

  const singleIndex: TableIndex = { name: 'b_id', type: Index.Secondary, columns: ['b_id'] };
  const compoundIndex: TableIndex = { name: 'b_id:created_at', type: Index.Secondary, columns: ['b_id', 'created_at'] };
  const otherIndex: TableIndex = { name: 'created_at:b_id', type: Index.Secondary, columns: ['created_at', 'b_id'] };

  it('assert :: new foreign key without an index', () => {
    deepEqual(getUnindexedForeignKeys(getRepository([]), getRepository([], false)), unindexedKey);
  });

  it('assert :: new foreign key led by an index', () => {
    deepEqual(getUnindexedForeignKeys(getRepository([singleIndex]), getRepository([], false)), []);
    deepEqual(getUnindexedForeignKeys(getRepository([compoundIndex]), getRepository([], false)), []);
  });

  it('assert :: new foreign key where its column is not the first one of an index', () => {
    deepEqual(getUnindexedForeignKeys(getRepository([otherIndex]), getRepository([], false)), unindexedKey);
  });

  it('assert :: new foreign key led by a partial index of its rows with a key', () => {
    const keyIndex: TableIndex = { ...singleIndex, options: { where: { b_id: { not: null } } } };
    const otherPartialIndex: TableIndex = { ...singleIndex, options: { where: { created_at: null } } };

    deepEqual(getUnindexedForeignKeys(getRepository([keyIndex]), getRepository([], false)), []);
    deepEqual(getUnindexedForeignKeys(getRepository([otherPartialIndex]), getRepository([], false)), unindexedKey);
  });

  it('assert :: foreign key losing its index', () => {
    deepEqual(getUnindexedForeignKeys(getRepository([]), getRepository([singleIndex])), unindexedKey);
  });

  it('assert :: foreign key that already had no index', () => {
    deepEqual(getUnindexedForeignKeys(getRepository([]), getRepository([])), []);
  });
});
