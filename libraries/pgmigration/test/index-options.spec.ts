import type { TableIndex } from '@ez4/database/library';

import { describe, it } from 'node:test';
import { deepEqual } from 'assert/strict';

import { getUpdateStepQueries } from '@ez4/pgmigration';
import { getTableRepository } from '@ez4/pgclient/library';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { getIndexValidation, getRebuildIndexStatement } from './common/indexes';

describe('migration :: index options tests', () => {
  const getDatabaseTables = (indexes: TableIndex[] = [], table = 'table') => {
    return getTableRepository([
      {
        name: table,
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            account_id: { type: SchemaType.String },
            status: { type: SchemaType.String },
            created_at: { type: SchemaType.String },
            deleted_at: { type: SchemaType.String, nullable: true, optional: true }
          }
        },
        indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }, ...indexes]
      }
    ]);
  };

  const secondaryIndex: TableIndex = {
    name: 'account_id:created_at:active',
    type: Index.Secondary,
    columns: ['account_id', 'created_at'],
    options: {
      where: { deleted_at: null, status: { isIn: ['open', 'pending'] } },
      include: ['status'],
      order: { created_at: 'desc' }
    }
  };

  const uniqueIndex: TableIndex = {
    name: 'account_id:status',
    type: Index.Unique,
    columns: ['account_id', 'status'],
    options: {
      name: 'table_account_open_status_key',
      where: { deleted_at: null },
      nullsNotDistinct: true
    }
  };

  it('assert :: create secondary index with options', () => {
    const steps = getUpdateStepQueries(getDatabaseTables([secondaryIndex]), getDatabaseTables());

    deepEqual(steps.rollout.indexes, [
      getRebuildIndexStatement('table_account_id_created_at_active_sk'),
      {
        query:
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_account_id_created_at_active_sk" ON "table" USING BTREE ` +
          `("account_id", "created_at" DESC) INCLUDE ("status") ` +
          `WHERE "deleted_at" IS null AND "status" IN ('open', 'pending')`,
        concurrent: true
      }
    ]);

    deepEqual(steps.rollout.validations, [getIndexValidation('table_account_id_created_at_active_sk')]);
  });

  it('assert :: create unique index with options', () => {
    const steps = getUpdateStepQueries(getDatabaseTables([uniqueIndex]), getDatabaseTables());

    deepEqual(steps.rollout.indexes, [
      getRebuildIndexStatement('table_account_open_status_key'),
      {
        assert: `SELECT 1 FROM "table" WHERE "deleted_at" IS null ` + `GROUP BY "account_id", "status" HAVING COUNT(*) > 1 LIMIT 1`,
        query:
          `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "table_account_open_status_key" ON "table" USING BTREE ` +
          `("account_id", "status") NULLS NOT DISTINCT WHERE "deleted_at" IS null`,
        concurrent: true,
        name: 'table_account_open_status_key'
      }
    ]);
  });

  it('assert :: create index with a method', () => {
    const index: TableIndex = { name: 'status', type: Index.Secondary, columns: ['status'], options: { method: 'hash' } };

    const steps = getUpdateStepQueries(getDatabaseTables([index]), getDatabaseTables());

    deepEqual(steps.rollout.indexes[1].query, `CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_status_sk" ON "table" USING HASH ("status")`);
  });

  it('assert :: update index predicate', () => {
    const updatedIndex: TableIndex = { ...secondaryIndex, options: { ...secondaryIndex.options, where: { deleted_at: null } } };

    const steps = getUpdateStepQueries(getDatabaseTables([updatedIndex]), getDatabaseTables([secondaryIndex]));

    deepEqual(
      steps.rollout.indexes.map(({ query }) => query),
      [
        'DROP INDEX CONCURRENTLY IF EXISTS "table_account_id_created_at_active_tmp_sk"',
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_account_id_created_at_active_tmp_sk" ON "table" USING BTREE ` +
          `("account_id", "created_at" DESC) INCLUDE ("status") WHERE "deleted_at" IS null`
      ]
    );

    deepEqual(
      steps.cleanup.indexes.map(({ query }) => query),
      [
        'DROP INDEX CONCURRENTLY IF EXISTS "table_account_id_created_at_active_sk"',
        'ALTER INDEX IF EXISTS "table_account_id_created_at_active_tmp_sk" RENAME TO "table_account_id_created_at_active_sk"'
      ]
    );
  });

  it('assert :: rename table keeps the explicit index name', () => {
    const sourceTable = getDatabaseTables([uniqueIndex]);
    const renamedTable = getDatabaseTables([uniqueIndex], 'renamed_table');

    const steps = getUpdateStepQueries(renamedTable, sourceTable);

    deepEqual(steps.rollout.indexes, []);
  });

  it('assert :: delete index with an explicit name', () => {
    const steps = getUpdateStepQueries(getDatabaseTables(), getDatabaseTables([uniqueIndex]));

    deepEqual(steps.cleanup.indexes, [
      {
        query: 'DROP INDEX CONCURRENTLY IF EXISTS "table_account_open_status_key"',
        concurrent: true
      }
    ]);
  });
});
