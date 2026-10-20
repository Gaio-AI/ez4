import type { TableRelation } from '@ez4/database/library';

import { deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import { getCreateQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { getTableRepository } from '@ez4/pgclient/library';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: update relation options tests', () => {
  const getDatabaseTables = (nullable: boolean, relation: Partial<TableRelation> = {}) => {
    return getTableRepository([
      {
        name: 'table_a',
        indexes: [],
        relations: [
          {
            sourceTable: 'table_b',
            sourceColumn: 'column_b',
            sourceIndex: Index.Primary,
            targetAlias: 'relation',
            targetColumn: 'column_a',
            targetIndex: Index.Secondary,
            ...relation
          }
        ],
        schema: {
          type: SchemaType.Object,
          properties: {
            column_a: {
              type: SchemaType.String,
              optional: nullable,
              nullable: nullable
            },
            other_column: {
              type: SchemaType.String
            }
          }
        }
      },
      {
        name: 'table_b',
        indexes: [],
        schema: {
          type: SchemaType.Object,
          properties: {
            column_b: {
              type: SchemaType.String
            }
          }
        }
      }
    ]);
  };

  const getEmptyQueries = () => {
    return {
      tables: [],
      constraints: [],
      validations: [],
      relations: [],
      indexes: []
    };
  };

  // The statements that replace the foreign key with one built from the given definition.
  const getRecreateSteps = (sourceColumn: string, onDelete: string) => {
    return {
      rollout: {
        validations: [
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "convalidated" = false AND "conname" = 'table_a_relation_tmp_fk'`,
            retry: `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" ILIKE '%' || '"table_a_relation_tmp_fk"' || '%' LIMIT 1`,
            name: 'table_a_relation_fk'
          }
        ],
        relations: [
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "conname" = 'table_a_relation_tmp_fk'`,
            query:
              `ALTER TABLE IF EXISTS "table_a" ADD CONSTRAINT "table_a_relation_tmp_fk" ` +
              `FOREIGN KEY ("column_a") REFERENCES "table_b" ("${sourceColumn}") ` +
              `ON DELETE ${onDelete} ` +
              `ON UPDATE CASCADE ` +
              `NOT VALID`
          },
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "convalidated" = true AND "conname" = 'table_a_relation_tmp_fk'`,
            query: `ALTER TABLE IF EXISTS "table_a" VALIDATE CONSTRAINT "table_a_relation_tmp_fk"`
          }
        ]
      },
      cleanup: {
        relations: [
          {
            query: 'ALTER TABLE IF EXISTS "table_a" DROP CONSTRAINT IF EXISTS "table_a_relation_fk"'
          },
          {
            query: 'ALTER TABLE IF EXISTS "table_a" RENAME CONSTRAINT "table_a_relation_tmp_fk" TO "table_a_relation_fk"'
          }
        ]
      }
    };
  };

  it('assert :: create relation with a delete action', () => {
    const queries = getCreateQueries(getDatabaseTables(true, { onDelete: 'no action' }));

    deepEqual(queries.relations[0], {
      check: `SELECT 1 FROM "pg_constraint" WHERE "conname" = 'table_a_relation_fk'`,
      query:
        `ALTER TABLE IF EXISTS "table_a" ADD CONSTRAINT "table_a_relation_fk" ` +
        `FOREIGN KEY ("column_a") REFERENCES "table_b" ("column_b") ` +
        `ON DELETE NO ACTION ` +
        `ON UPDATE CASCADE ` +
        `NOT VALID`
    });
  });

  it('assert :: create relation with a foreign key between primary keys', () => {
    const repository = getDatabaseTables(false, { targetIndex: Index.Primary, foreignKey: true });

    deepEqual(getCreateQueries(repository).relations.length, 2);
    deepEqual(getCreateQueries(getDatabaseTables(false, { targetIndex: Index.Primary })).relations, []);
  });

  it('assert :: update relation delete action', () => {
    const sourceTable = getDatabaseTables(true);
    const targetTable = getDatabaseTables(true, { onDelete: 'restrict' });

    const { prepare, rollout, cleanup } = getUpdateStepQueries(targetTable, sourceTable);
    const expected = getRecreateSteps('column_b', 'RESTRICT');

    deepEqual(prepare, getEmptyQueries());
    deepEqual(rollout, { ...getEmptyQueries(), ...expected.rollout });
    deepEqual(cleanup, { ...getEmptyQueries(), ...expected.cleanup });
  });

  it('assert :: update relation to the delete action it already has', () => {
    const sourceTable = getDatabaseTables(true);
    const targetTable = getDatabaseTables(true, { onDelete: 'set null' });

    const { prepare, rollout, cleanup } = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(prepare, getEmptyQueries());
    deepEqual(rollout, getEmptyQueries());
    deepEqual(cleanup, getEmptyQueries());
  });

  it('assert :: update column nullability with a delete action', () => {
    const sourceTable = getDatabaseTables(true, { onDelete: 'cascade' });
    const targetTable = getDatabaseTables(false, { onDelete: 'cascade' });

    const { rollout, cleanup } = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(rollout.relations, []);
    deepEqual(rollout.validations, []);
    deepEqual(cleanup.relations, []);
  });

  it('assert :: update relation source column and nullability at once', () => {
    const sourceTable = getDatabaseTables(true);
    const targetTable = getDatabaseTables(false, { sourceColumn: 'other_column' });

    const { rollout, cleanup } = getUpdateStepQueries(targetTable, sourceTable);
    const expected = getRecreateSteps('other_column', 'CASCADE');

    deepEqual(rollout.relations, expected.rollout.relations);
    deepEqual(rollout.validations, expected.rollout.validations);
    deepEqual(cleanup.relations, expected.cleanup.relations);
  });

  it('assert :: update relation to hold a foreign key', () => {
    const sourceTable = getDatabaseTables(false, { targetIndex: Index.Primary });
    const targetTable = getDatabaseTables(false, { targetIndex: Index.Primary, foreignKey: true });

    const { rollout, cleanup } = getUpdateStepQueries(targetTable, sourceTable);
    const expected = getRecreateSteps('column_b', 'CASCADE');

    deepEqual(rollout.relations, expected.rollout.relations);
    deepEqual(cleanup.relations, expected.cleanup.relations);
  });

  it('assert :: update relation to hold no foreign key', () => {
    const sourceTable = getDatabaseTables(false);
    const targetTable = getDatabaseTables(false, { foreignKey: false });

    const { rollout, cleanup } = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(rollout.relations, []);
    deepEqual(cleanup.relations, [
      {
        query: 'ALTER TABLE IF EXISTS "table_a" DROP CONSTRAINT IF EXISTS "table_a_relation_fk"'
      }
    ]);
  });
});
