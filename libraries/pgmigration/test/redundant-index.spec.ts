import type { TableIndex } from '@ez4/database/library';

import { describe, it } from 'node:test';
import { deepEqual } from 'assert/strict';

import { getTableRepository } from '@ez4/pgclient/library';
import { getRedundantIndexes } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: redundant index tests', () => {
  const getRepository = (indexes: TableIndex[]) => {
    return getTableRepository([
      {
        name: 'table',
        indexes,
        schema: {
          type: SchemaType.Object,
          properties: {
            account_id: { type: SchemaType.String },
            created_at: { type: SchemaType.String },
            deleted_at: { type: SchemaType.String, nullable: true, optional: true }
          }
        }
      }
    ]);
  };

  const accountIndex: TableIndex = { name: 'account_id', type: Index.Secondary, columns: ['account_id'] };
  const accountDateIndex: TableIndex = { name: 'account_id:created_at', type: Index.Secondary, columns: ['account_id', 'created_at'] };

  const partialAccountDateIndex: TableIndex = {
    ...accountDateIndex,
    options: { where: { deleted_at: null } }
  };

  const redundantIndex = [{ table: 'table', index: 'account_id', coveringIndex: 'account_id:created_at' }];

  it('assert :: new index covered by another one', () => {
    deepEqual(getRedundantIndexes(getRepository([accountIndex, accountDateIndex]), getRepository([accountDateIndex])), redundantIndex);
  });

  it('assert :: new index covering another one', () => {
    deepEqual(getRedundantIndexes(getRepository([accountIndex, accountDateIndex]), getRepository([accountIndex])), redundantIndex);
  });

  it('assert :: index covered since before', () => {
    const repository = getRepository([accountIndex, accountDateIndex]);

    deepEqual(getRedundantIndexes(repository, repository), []);
  });

  it('assert :: index covered by a partial index', () => {
    deepEqual(getRedundantIndexes(getRepository([accountIndex, partialAccountDateIndex]), getRepository([])), []);
  });
});
