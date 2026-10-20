import type { PgTableRepository } from '@ez4/pgclient/library';
import type { MigrationState } from '../src/migration/types';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';
import { Logger } from '@ez4/logger';

import { getMigrationHandler } from '../src/migration/handler';
import { MigrationServiceType } from '../src/migration/types';

const getRepository = (withRelation: boolean): PgTableRepository => ({
  items: {
    name: 'items',
    indexes: {
      id: { name: 'id', columns: ['id'], type: Index.Primary }
    },
    relations: withRelation
      ? {
          owner: {
            sourceTable: 'owners',
            sourceColumn: 'id',
            sourceIndex: Index.Primary,
            targetColumn: 'owner_id'
          }
        }
      : {},
    schema: {
      type: SchemaType.Object,
      properties: {
        id: { type: SchemaType.String },
        owner_id: { type: SchemaType.String }
      }
    }
  },
  owners: {
    name: 'owners',
    relations: {},
    indexes: {
      id: { name: 'id', columns: ['id'], type: Index.Primary }
    },
    schema: {
      type: SchemaType.Object,
      properties: {
        id: { type: SchemaType.String }
      }
    }
  }
});

const getState = (repository: PgTableRepository): MigrationState => ({
  type: MigrationServiceType,
  entryId: 'migration',
  dependencies: [],
  parameters: {
    database: 'test',
    repository
  }
});

describe('aurora migration preview', () => {
  it('assert :: warns about a new foreign key without an index', (t) => {
    const warnings: string[] = [];

    t.mock.method(Logger, 'warn', (message: string) => {
      warnings.push(message);
    });

    getMigrationHandler().preview(getState(getRepository(true)), getState(getRepository(false)), { force: false });

    deepEqual(warnings, ['Foreign key items.owner_id has no index led by owner_id: deleting or updating a record of owners scans items.']);
  });
});
