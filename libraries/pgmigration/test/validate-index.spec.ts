import type { MigrationIndexError } from '@ez4/pgmigration/library';
import type { TableIndex } from '@ez4/database/library';

import { describe, it } from 'node:test';
import { equal, throws } from 'assert/strict';

import { getTableRepository } from '@ez4/pgclient/library';
import { validateRepository } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: validate index tests', () => {
  const getRepository = (index: Partial<TableIndex>) => {
    return getTableRepository([
      {
        name: 'table',
        indexes: [
          {
            name: 'value',
            type: Index.Secondary,
            columns: ['value'],
            ...index
          }
        ],
        schema: {
          type: SchemaType.Object,
          properties: {
            value: { type: SchemaType.String },
            other: { type: SchemaType.String }
          }
        }
      }
    ]);
  };

  const assertIndexError = (index: Partial<TableIndex>, message: string) => {
    throws(
      () => validateRepository(getRepository(index)),
      (error: MigrationIndexError) => {
        equal(error.message, message);
        return true;
      }
    );
  };

  it('assert :: valid index options', () => {
    validateRepository(
      getRepository({
        type: Index.Unique,
        options: {
          where: { other: { not: null }, value: { isIn: ['a', 'b'] } },
          include: ['other'],
          order: { value: 'desc' },
          nullsNotDistinct: true
        }
      })
    );
  });

  it('assert :: unique index of another method', () => {
    assertIndexError({ type: Index.Unique, options: { method: 'hash' } }, 'Index table.value is unique, which only a btree index can be.');
  });

  it('assert :: nulls not distinct on a secondary index', () => {
    assertIndexError({ options: { nullsNotDistinct: true } }, 'Index table.value has nulls not distinct, which only a unique index takes.');
  });

  it('assert :: order on an index of another method', () => {
    assertIndexError(
      { options: { method: 'gin', order: { value: 'desc' } } },
      'Index table.value has an order, which only a btree index keeps.'
    );
  });

  it('assert :: included columns on an index of another method', () => {
    assertIndexError(
      { options: { method: 'gin', include: ['other'] } },
      'Index table.value includes columns, which only a btree or gist index stores.'
    );
  });

  it('assert :: predicate with an unsupported operator', () => {
    assertIndexError(
      { options: { where: { value: { contains: 'a' } } } },
      'Index table.value has a where with an operator other than equal, not, gt, gte, lt, lte, isIn, isNull.'
    );
  });
});
