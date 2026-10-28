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

  const DELETE_ACTION_CODES: Record<string, string> = {
    CASCADE: 'c',
    'SET NULL': 'n',
    RESTRICT: 'r',
    'NO ACTION': 'a'
  };

  // The statements that replace the foreign key with one built from the given definition, each one
  // skipped when the key already has that definition.
  const getRecreateSteps = (sourceColumn: string, onDelete: string) => {
    const keptKey =
      `SELECT 1 FROM "pg_constraint" WHERE "conname" = 'table_a_relation_fk' AND "contype" = 'f' AND "convalidated" ` +
      `AND "confupdtype" = 'c' AND "confdeltype" = '${DELETE_ACTION_CODES[onDelete]}' ` +
      `AND starts_with(pg_get_constraintdef("oid"), 'FOREIGN KEY (' || quote_ident('column_a') || ') REFERENCES ' || ` +
      `quote_ident('table_b') || '(' || quote_ident('${sourceColumn}') || ')')`;

    const tmpMissing = `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'table_a_relation_tmp_fk')`;
    const condition = 'unless the foreign key already has this definition';

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
            check: `SELECT 1 WHERE EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'table_a_relation_tmp_fk') OR EXISTS (${keptKey})`,
            query:
              `ALTER TABLE IF EXISTS "table_a" ADD CONSTRAINT "table_a_relation_tmp_fk" ` +
              `FOREIGN KEY ("column_a") REFERENCES "table_b" ("${sourceColumn}") ` +
              `ON DELETE ${onDelete} ` +
              `ON UPDATE CASCADE ` +
              `NOT VALID`,
            condition
          },
          {
            check: `SELECT 1 WHERE EXISTS (SELECT 1 FROM "pg_constraint" WHERE "convalidated" = true AND "conname" = 'table_a_relation_tmp_fk') OR EXISTS (${keptKey})`,
            query: `ALTER TABLE IF EXISTS "table_a" VALIDATE CONSTRAINT "table_a_relation_tmp_fk"`,
            condition
          }
        ]
      },
      cleanup: {
        relations: [
          {
            check: `SELECT 1 WHERE EXISTS (${keptKey}) AND EXISTS (${tmpMissing})`,
            query: 'ALTER TABLE IF EXISTS "table_a" DROP CONSTRAINT IF EXISTS "table_a_relation_fk"',
            condition
          },
          {
            check: tmpMissing,
            query: 'ALTER TABLE IF EXISTS "table_a" RENAME CONSTRAINT "table_a_relation_tmp_fk" TO "table_a_relation_fk"',
            condition
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
