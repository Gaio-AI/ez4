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
      'rollout.1': 'DROP INDEX CONCURRENTLY IF EXISTS "table_value_sk" -- only when the index is invalid',
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
      'cleanup.2': 'ALTER TABLE IF EXISTS "contacts" DROP CONSTRAINT IF EXISTS "contacts_email_uk"',
      'cleanup.3': 'DROP INDEX CONCURRENTLY IF EXISTS "contacts_email_uk"'
    });
  });

  it('assert :: no statements for an unchanged repository', () => {
    const repository = getRepository(['id', 'value']);

    deepEqual(getMigrationStatements(repository, repository), {});
  });

  const getStampedRepository = (stamped: boolean) => {
    return getTableRepository([
      {
        name: 'contacts',
        indexes: [
          { name: 'id', type: Index.Primary, columns: ['id'] },
          { name: 'email', type: Index.Unique, columns: ['email'] }
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
        ...(stamped && {
          timestamps: {
            updated: 'updated_at'
          },
          relations: [
            {
              sourceTable: 'contacts',
              sourceColumn: 'email',
              sourceIndex: Index.Unique,
              targetColumn: 'contact_email',
              targetAlias: 'contact'
            }
          ]
        }),
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            contact_email: { type: SchemaType.String },
            ...(stamped && {
              updated_at: { type: SchemaType.String, format: 'date-time' as const }
            })
          }
        }
      }
    ]);
  };

  it('assert :: triggers run after the tables and before the keys they build', () => {
    const repository = getTableRepository([
      {
        name: 'messages',
        indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }],
        timestamps: {
          updated: 'updated_at'
        },
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            updated_at: { type: SchemaType.String, format: 'date-time' }
          }
        }
      }
    ]);

    deepEqual(getMigrationStatements(repository, {}), {
      'prepare.1':
        `CREATE TABLE IF NOT EXISTS "messages" ("id" text NOT null, ` +
        `"updated_at" timestamptz DEFAULT date_trunc('milliseconds', statement_timestamp()) NOT null)`,
      'prepare.2':
        `CREATE OR REPLACE FUNCTION "ez4_stamp_updated_at"() RETURNS trigger LANGUAGE plpgsql AS ` +
        `$fn$ BEGIN NEW."updated_at" := date_trunc('milliseconds', statement_timestamp()); RETURN NEW; END $fn$`,
      'prepare.3': `CREATE TRIGGER "ez4_stamp_updated_at" BEFORE UPDATE ON "messages" FOR EACH ROW EXECUTE FUNCTION "ez4_stamp_updated_at"()`,
      'prepare.4': `ALTER TABLE IF EXISTS "messages" ADD CONSTRAINT "messages_id_pk" PRIMARY KEY ("id")`
    });
  });

  it('assert :: cleanup drops the trigger after the foreign keys and before the columns', () => {
    deepEqual(getMigrationStatements(getStampedRepository(false), getStampedRepository(true)), {
      'cleanup.1': `ALTER TABLE IF EXISTS "messages" DROP CONSTRAINT IF EXISTS "messages_contact_fk"`,
      'cleanup.2': `DROP TRIGGER IF EXISTS "ez4_stamp_updated_at" ON "messages"`,
      'cleanup.3': `DROP FUNCTION IF EXISTS "ez4_stamp_updated_at"() RESTRICT`,
      'cleanup.4': `ALTER TABLE IF EXISTS "messages" DROP COLUMN IF EXISTS "updated_at"`
    });
  });
});
