import { deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import { getUpdateStepQueries } from '@ez4/pgmigration';
import { getTableRepository } from '@ez4/pgclient/library';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: update relation tests', () => {
  const getDatabaseTables = (nullable: boolean) => {
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
            targetIndex: Index.Secondary
          }
        ],
        schema: {
          type: SchemaType.Object,
          properties: {
            column_a: {
              type: SchemaType.String,
              optional: nullable,
              nullable: nullable
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

  // The statements that replace the foreign key, each one skipped when the key already has the new
  // definition.
  const getReplaceRelations = (column: string, sourceColumn: string, onDelete: string, deleteAction: string) => {
    const keptKey =
      `SELECT 1 FROM "pg_constraint" WHERE "conname" = 'table_a_relation_fk' AND "contype" = 'f' AND "convalidated" ` +
      `AND "confupdtype" = 'c' AND "confdeltype" = '${deleteAction}' ` +
      `AND starts_with(pg_get_constraintdef("oid"), 'FOREIGN KEY (' || quote_ident('${column}') || ') REFERENCES ' || ` +
      `quote_ident('table_b') || '(' || quote_ident('${sourceColumn}') || ')')`;

    const tmpMissing = `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'table_a_relation_tmp_fk')`;
    const condition = 'unless the foreign key already has this definition';

    return {
      rollout: [
        {
          check: `SELECT 1 WHERE EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'table_a_relation_tmp_fk') OR EXISTS (${keptKey})`,
          query:
            `ALTER TABLE IF EXISTS "table_a" ADD CONSTRAINT "table_a_relation_tmp_fk" ` +
            `FOREIGN KEY ("${column}") REFERENCES "table_b" ("${sourceColumn}") ` +
            `ON DELETE ${onDelete} ON UPDATE CASCADE NOT VALID`,
          condition
        },
        {
          check: `SELECT 1 WHERE EXISTS (SELECT 1 FROM "pg_constraint" WHERE "convalidated" = true AND "conname" = 'table_a_relation_tmp_fk') OR EXISTS (${keptKey})`,
          query: `ALTER TABLE IF EXISTS "table_a" VALIDATE CONSTRAINT "table_a_relation_tmp_fk"`,
          condition
        }
      ],
      cleanup: [
        {
          check: `SELECT 1 WHERE EXISTS (${keptKey}) AND EXISTS (${tmpMissing})`,
          query: `ALTER TABLE IF EXISTS "table_a" DROP CONSTRAINT IF EXISTS "table_a_relation_fk"`,
          condition
        },
        {
          check: tmpMissing,
          query: 'ALTER TABLE IF EXISTS "table_a" RENAME CONSTRAINT "table_a_relation_tmp_fk" TO "table_a_relation_fk"',
          condition
        }
      ]
    };
  };

  it('assert :: update relation (set mandatory)', async () => {
    const sourceTable = getDatabaseTables(true);
    const targetTable = getDatabaseTables(false);

    const steps = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(steps, {
      prepare: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      rollout: {
        tables: [
          {
            check: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE "column_name" = 'column_a' AND "table_name" = 'table_a')`,
            query: `ALTER TABLE IF EXISTS "table_a" ALTER COLUMN "column_a" SET NOT null`
          }
        ],
        constraints: [],
        validations: [
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "convalidated" = false AND "conname" = 'table_a_relation_tmp_fk'`,
            retry: `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" ILIKE '%' || '"table_a_relation_tmp_fk"' || '%' LIMIT 1`,
            name: 'table_a_relation_fk'
          }
        ],
        relations: getReplaceRelations('column_a', 'column_b', 'CASCADE', 'c').rollout,
        indexes: []
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: getReplaceRelations('column_a', 'column_b', 'CASCADE', 'c').cleanup,
        indexes: []
      }
    });
  });

  it('assert :: update relation (set nullable)', async () => {
    const sourceTable = getDatabaseTables(false);
    const targetTable = getDatabaseTables(true);

    const steps = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(steps, {
      prepare: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      rollout: {
        tables: [
          {
            check: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE "column_name" = 'column_a' AND "table_name" = 'table_a')`,
            query: `ALTER TABLE IF EXISTS "table_a" ALTER COLUMN "column_a" DROP NOT null`
          }
        ],
        constraints: [],
        validations: [
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "convalidated" = false AND "conname" = 'table_a_relation_tmp_fk'`,
            retry: `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" ILIKE '%' || '"table_a_relation_tmp_fk"' || '%' LIMIT 1`,
            name: 'table_a_relation_fk'
          }
        ],
        relations: getReplaceRelations('column_a', 'column_b', 'SET null', 'n').rollout,
        indexes: []
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: getReplaceRelations('column_a', 'column_b', 'SET null', 'n').cleanup,
        indexes: []
      }
    });
  });

  it('assert :: update relation source column', () => {
    const sourceTable = getDatabaseTables(false);
    const baseTarget = getDatabaseTables(false);

    const targetTable = {
      ...baseTarget,
      table_a: {
        ...baseTarget.table_a,
        relations: {
          relation: {
            ...baseTarget.table_a.relations.relation,
            sourceColumn: 'other_column'
          }
        }
      }
    };

    const steps = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(steps, {
      prepare: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      rollout: {
        tables: [],
        constraints: [],
        validations: [
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "convalidated" = false AND "conname" = 'table_a_relation_tmp_fk'`,
            retry: `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" ILIKE '%' || '"table_a_relation_tmp_fk"' || '%' LIMIT 1`,
            name: 'table_a_relation_fk'
          }
        ],
        relations: getReplaceRelations('column_a', 'other_column', 'CASCADE', 'c').rollout,
        indexes: []
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: getReplaceRelations('column_a', 'other_column', 'CASCADE', 'c').cleanup,
        indexes: []
      }
    });
  });

  it('assert :: update relation to secondary source', () => {
    const sourceTable = getDatabaseTables(false);
    const baseTarget = getDatabaseTables(false);

    const targetTable = {
      ...baseTarget,
      table_a: {
        ...baseTarget.table_a,
        relations: {
          relation: {
            ...baseTarget.table_a.relations.relation,
            sourceIndex: Index.Secondary
          }
        }
      }
    };

    const steps = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(steps, {
      prepare: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      rollout: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [
          {
            query: 'ALTER TABLE IF EXISTS "table_a" DROP CONSTRAINT IF EXISTS "table_a_relation_fk"'
          }
        ],
        indexes: []
      }
    });
  });

  it('assert :: update relation target index (same foreign key)', () => {
    const sourceTable = getDatabaseTables(false);
    const baseTarget = getDatabaseTables(false);

    const targetTable = {
      ...baseTarget,
      table_a: {
        ...baseTarget.table_a,
        relations: {
          relation: {
            ...baseTarget.table_a.relations.relation,
            targetIndex: undefined
          }
        }
      }
    };

    const steps = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(steps, {
      prepare: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      rollout: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      }
    });
  });

  it('assert :: update relation source index (same foreign key)', () => {
    const sourceTable = getDatabaseTables(false);
    const baseTarget = getDatabaseTables(false);

    const targetTable = {
      ...baseTarget,
      table_a: {
        ...baseTarget.table_a,
        relations: {
          relation: {
            ...baseTarget.table_a.relations.relation,
            sourceIndex: Index.Unique
          }
        }
      }
    };

    const steps = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(steps, {
      prepare: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      rollout: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      }
    });
  });

  it('assert :: rename relation (with table rename)', () => {
    const sourceTable = getDatabaseTables(false);

    const targetTable = {
      table_b: sourceTable.table_b,
      renamed_table_a: {
        ...sourceTable.table_a,
        name: 'renamed_table_a'
      }
    };

    const steps = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(steps, {
      prepare: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      rollout: {
        tables: [
          {
            query: 'ALTER TABLE IF EXISTS "table_a" RENAME TO "renamed_table_a"'
          }
        ],
        constraints: [],
        validations: [],
        relations: [
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "conname" = 'renamed_table_a_relation_fk'`,
            query: 'ALTER TABLE IF EXISTS "renamed_table_a" RENAME CONSTRAINT "table_a_relation_fk" TO "renamed_table_a_relation_fk"'
          }
        ],
        indexes: []
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      }
    });
  });

  it('assert :: rename relation (with column rename)', () => {
    const sourceTable = getDatabaseTables(false);
    const baseTable = sourceTable.table_a;

    const targetTable = {
      ...sourceTable,
      table_a: {
        ...baseTable,
        schema: {
          ...baseTable.schema,
          properties: {
            renamed_column_a: baseTable.schema.properties.column_a
          }
        },
        relations: {
          relation: {
            ...baseTable.relations.relation,
            targetColumn: 'renamed_column_a'
          }
        }
      }
    };

    const steps = getUpdateStepQueries(targetTable, sourceTable);

    deepEqual(steps, {
      prepare: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: []
      },
      rollout: {
        tables: [
          {
            check: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE "column_name" = 'column_a' AND "table_name" = 'table_a')`,
            query: 'ALTER TABLE IF EXISTS "table_a" RENAME COLUMN "column_a" TO "renamed_column_a"'
          }
        ],
        constraints: [],
        validations: [
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "convalidated" = false AND "conname" = 'table_a_relation_tmp_fk'`,
            retry: `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" ILIKE '%' || '"table_a_relation_tmp_fk"' || '%' LIMIT 1`,
            name: 'table_a_relation_fk'
          }
        ],
        relations: getReplaceRelations('renamed_column_a', 'column_b', 'CASCADE', 'c').rollout,
        indexes: []
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: getReplaceRelations('renamed_column_a', 'column_b', 'CASCADE', 'c').cleanup,
        indexes: []
      }
    });
  });
});
