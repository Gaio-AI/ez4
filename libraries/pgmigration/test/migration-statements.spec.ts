import type { TableIndex } from '@ez4/database/library';

import { describe, it } from 'node:test';
import { deepEqual } from 'assert/strict';

import { getMigrationStatements } from '@ez4/pgmigration';
import { getTableRepository } from '@ez4/pgclient/library';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: migration statements tests', () => {
  const getRepository = (columns: string[], indexes: TableIndex[] = []) => {
    return getTableRepository([
      {
        name: 'table',
        indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }, ...indexes],
        schema: {
          type: SchemaType.Object,
          properties: Object.fromEntries(columns.map((column) => [column, { type: SchemaType.String, optional: true }]))
        }
      }
    ]);
  };

  it('assert :: statements of each step in the order they run', () => {
    const sourceRepository = getRepository(['id', 'legacy']);
    const targetRepository = getRepository(['id', 'value'], [{ name: 'value', type: Index.Secondary, columns: ['value'] }]);

    deepEqual(getMigrationStatements(targetRepository, sourceRepository), {
      'prepare.1': `ALTER TABLE IF EXISTS "table" ADD COLUMN IF NOT EXISTS "value" text DEFAULT null`,
      'rollout.1': 'DROP INDEX CONCURRENTLY IF EXISTS "table_value_sk"',
      'rollout.2': `CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_value_sk" ON "table" USING BTREE ("value")`,
      'cleanup.1': `ALTER TABLE IF EXISTS "table" DROP COLUMN IF EXISTS "legacy"`
    });
  });

  it('assert :: cleanup drops foreign keys before the keys they reference', () => {
    const getRelatedRepository = (related: boolean) => {
      return getTableRepository([
        {
          name: 'contacts',
          indexes: [
            { name: 'id', type: Index.Primary, columns: ['id'] },
            ...(related ? [{ name: 'email', type: Index.Unique, columns: ['email'] }] : [])
          ],
          schema: {
            type: SchemaType.Object,
            properties: {
              id: { type: SchemaType.String },
              email: { type: SchemaType.String }
            }
          }
        },
        {
          name: 'messages',
          indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }],
          relations: related
            ? [
                {
                  sourceTable: 'contacts',
                  sourceColumn: 'email',
                  sourceIndex: Index.Unique,
                  targetColumn: 'contact_email',
                  targetAlias: 'contact'
                }
              ]
            : [],
          schema: {
            type: SchemaType.Object,
            properties: {
              id: { type: SchemaType.String },
              contact_email: { type: SchemaType.String }
            }
          }
        }
      ]);
    };

    deepEqual(getMigrationStatements(getRelatedRepository(false), getRelatedRepository(true)), {
      'cleanup.1': `ALTER TABLE IF EXISTS "messages" DROP CONSTRAINT IF EXISTS "messages_contact_fk"`,
      'cleanup.2': 'DROP INDEX CONCURRENTLY IF EXISTS "contacts_email_uk"'
    });
  });

  it('assert :: no statements for an unchanged repository', () => {
    const repository = getRepository(['id', 'value']);

    deepEqual(getMigrationStatements(repository, repository), {});
  });
});
