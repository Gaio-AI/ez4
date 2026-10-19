import type { ObjectSchemaProperties } from '@ez4/schema';
import type { TableIndex } from '@ez4/database/library';

import { deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import { getUpdateStepQueries } from '@ez4/pgmigration';
import { getTableRepository } from '@ez4/pgclient/library';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { getIndexValidation, getPrimaryKeySwapStatements, getRebuildIndexStatement } from './common/indexes';

describe('migration :: update index tests', () => {
  const getDatabaseTables = (properties: ObjectSchemaProperties, indexes: TableIndex[] = []) => {
    return getTableRepository([
      {
        name: 'table',
        schema: {
          type: SchemaType.Object,
          properties
        },
        indexes
      }
    ]);
  };

  const singleColumn: ObjectSchemaProperties = {
    column: {
      type: SchemaType.String
    }
  };

  const primaryIndex: TableIndex = {
    name: 'index',
    type: Index.Primary,
    columns: ['column']
  };

  const secondaryIndex: TableIndex = {
    name: 'index',
    type: Index.Secondary,
    columns: ['column']
  };

  const uniqueIndex: TableIndex = {
    name: 'index',
    type: Index.Unique,
    columns: ['column']
  };

  it('assert :: update index type (from primary to unique)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [primaryIndex]);
    const targetTable = getDatabaseTables(singleColumn, [uniqueIndex]);

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
        validations: [getIndexValidation('table_index_uk')],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_uk'),
          {
            assert: 'SELECT 1 FROM "table" WHERE "column" IS NOT null GROUP BY "column" HAVING COUNT(*) > 1 LIMIT 1',
            query: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "table_index_uk" ON "table" USING BTREE ("column")',
            concurrent: true,
            name: 'table_index_uk'
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: [
          {
            query: 'ALTER TABLE IF EXISTS "table" DROP CONSTRAINT IF EXISTS "table_index_pk"'
          }
        ],
        validations: [],
        relations: [],
        indexes: []
      }
    });
  });

  it('assert :: update index type (from primary to secondary)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [primaryIndex]);
    const targetTable = getDatabaseTables(singleColumn, [secondaryIndex]);

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
        validations: [getIndexValidation('table_index_sk')],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_sk'),
          {
            query: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_index_sk" ON "table" USING BTREE ("column")',
            concurrent: true
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: [
          {
            query: 'ALTER TABLE IF EXISTS "table" DROP CONSTRAINT IF EXISTS "table_index_pk"'
          }
        ],
        validations: [],
        relations: [],
        indexes: []
      }
    });
  });

  it('assert :: update index type (from unique to primary)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [uniqueIndex]);
    const targetTable = getDatabaseTables(singleColumn, [primaryIndex]);

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
        validations: [getIndexValidation('table_index_tmp_pk')],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_tmp_pk'),
          {
            assert: 'SELECT 1 FROM "table" WHERE "column" IS NOT null GROUP BY "column" HAVING COUNT(*) > 1 LIMIT 1',
            query: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "table_index_tmp_pk" ON "table" USING BTREE ("column")',
            concurrent: true,
            name: 'table_index_tmp_pk'
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: getPrimaryKeySwapStatements('table', 'table_index_tmp_pk', 'table_index_pk'),
        validations: [],
        relations: [],
        indexes: [
          {
            query: 'DROP INDEX CONCURRENTLY IF EXISTS "table_index_uk"',
            concurrent: true
          }
        ]
      }
    });
  });

  it('assert :: update index type (from unique to secondary)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [uniqueIndex]);
    const targetTable = getDatabaseTables(singleColumn, [secondaryIndex]);

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
        validations: [getIndexValidation('table_index_sk')],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_sk'),
          {
            query: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_index_sk" ON "table" USING BTREE ("column")`,
            concurrent: true
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: [
          {
            query: 'DROP INDEX CONCURRENTLY IF EXISTS "table_index_uk"',
            concurrent: true
          }
        ]
      }
    });
  });

  it('assert :: update index type (from secondary to unique)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [secondaryIndex]);
    const targetTable = getDatabaseTables(singleColumn, [uniqueIndex]);

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
        validations: [getIndexValidation('table_index_uk')],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_uk'),
          {
            assert: 'SELECT 1 FROM "table" WHERE "column" IS NOT null GROUP BY "column" HAVING COUNT(*) > 1 LIMIT 1',
            query: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "table_index_uk" ON "table" USING BTREE ("column")',
            concurrent: true,
            name: 'table_index_uk'
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: [
          {
            query: `DROP INDEX CONCURRENTLY IF EXISTS "table_index_sk"`,
            concurrent: true
          }
        ]
      }
    });
  });

  it('assert :: update index type (from secondary to primary)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [secondaryIndex]);
    const targetTable = getDatabaseTables(singleColumn, [primaryIndex]);

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
        validations: [getIndexValidation('table_index_tmp_pk')],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_tmp_pk'),
          {
            assert: 'SELECT 1 FROM "table" WHERE "column" IS NOT null GROUP BY "column" HAVING COUNT(*) > 1 LIMIT 1',
            query: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "table_index_tmp_pk" ON "table" USING BTREE ("column")',
            concurrent: true,
            name: 'table_index_tmp_pk'
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: getPrimaryKeySwapStatements('table', 'table_index_tmp_pk', 'table_index_pk'),
        validations: [],
        relations: [],
        indexes: [
          {
            query: `DROP INDEX CONCURRENTLY IF EXISTS "table_index_sk"`,
            concurrent: true
          }
        ]
      }
    });
  });

  it('assert :: update index columns (primary)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [primaryIndex]);
    const targetTable = getDatabaseTables(singleColumn, [{ ...primaryIndex, columns: [...primaryIndex.columns, 'other'] }]);

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
        validations: [getIndexValidation('table_index_tmp_pk')],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_tmp_pk'),
          {
            assert:
              'SELECT 1 FROM "table" WHERE "column" IS NOT null AND "other" IS NOT null GROUP BY "column", "other" HAVING COUNT(*) > 1 LIMIT 1',
            query: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "table_index_tmp_pk" ON "table" USING BTREE ("column", "other")',
            concurrent: true,
            name: 'table_index_tmp_pk'
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: getPrimaryKeySwapStatements('table', 'table_index_tmp_pk', 'table_index_pk', 'table_index_pk'),
        validations: [],
        relations: [],
        indexes: []
      }
    });
  });

  it('assert :: update index columns (unique)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [uniqueIndex]);
    const targetTable = getDatabaseTables(singleColumn, [{ ...uniqueIndex, columns: [...uniqueIndex.columns, 'other'] }]);

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
        validations: [getIndexValidation('table_index_tmp_uk')],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_tmp_uk'),
          {
            assert:
              'SELECT 1 FROM "table" WHERE "column" IS NOT null AND "other" IS NOT null GROUP BY "column", "other" HAVING COUNT(*) > 1 LIMIT 1',
            query: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "table_index_tmp_uk" ON "table" USING BTREE ("column", "other")',
            concurrent: true,
            name: 'table_index_tmp_uk'
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: [
          {
            check: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM "pg_class" WHERE "relname" = 'table_index_tmp_uk' AND "relkind" = 'i')`,
            query: 'DROP INDEX CONCURRENTLY IF EXISTS "table_index_uk"',
            concurrent: true
          },
          {
            query: 'ALTER INDEX IF EXISTS "table_index_tmp_uk" RENAME TO "table_index_uk"'
          }
        ]
      }
    });
  });

  it('assert :: update index columns (secondary)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [secondaryIndex]);
    const targetTable = getDatabaseTables(singleColumn, [{ ...secondaryIndex, columns: [...secondaryIndex.columns, 'other'] }]);

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
        validations: [getIndexValidation('table_index_tmp_sk')],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_tmp_sk'),
          {
            query: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_index_tmp_sk" ON "table" USING BTREE ("column", "other")',
            concurrent: true
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: [
          {
            check: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM "pg_class" WHERE "relname" = 'table_index_tmp_sk' AND "relkind" = 'i')`,
            query: 'DROP INDEX CONCURRENTLY IF EXISTS "table_index_sk"',
            concurrent: true
          },
          {
            query: 'ALTER INDEX IF EXISTS "table_index_tmp_sk" RENAME TO "table_index_sk"'
          }
        ]
      }
    });
  });

  it('assert :: rename index (primary)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [primaryIndex]);

    const targetTable = getDatabaseTables(singleColumn, [
      {
        ...primaryIndex,
        name: 'index_renamed'
      }
    ]);

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
        constraints: [
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "conname" = 'table_index_renamed_pk'`,
            query: 'ALTER TABLE IF EXISTS "table" RENAME CONSTRAINT "table_index_pk" TO "table_index_renamed_pk"'
          }
        ],
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

  it('assert :: rename index (unique)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [uniqueIndex]);
    const targetTable = getDatabaseTables(singleColumn, [{ ...uniqueIndex, name: 'index_renamed' }]);

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
        indexes: [
          {
            query: 'ALTER INDEX IF EXISTS "table_index_uk" RENAME TO "table_index_renamed_uk"'
          }
        ]
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

  it('assert :: rename index (secondary)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [secondaryIndex]);
    const targetTable = getDatabaseTables(singleColumn, [{ ...secondaryIndex, name: 'index_renamed' }]);

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
        indexes: [
          {
            query: 'ALTER INDEX IF EXISTS "table_index_sk" RENAME TO "table_index_renamed_sk"'
          }
        ]
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

  it('assert :: rename and change index columns (secondary)', async () => {
    const sourceTable = getDatabaseTables(singleColumn, [secondaryIndex]);

    const targetTable = getDatabaseTables(singleColumn, [
      {
        ...secondaryIndex,
        columns: [...secondaryIndex.columns, 'other'],
        name: 'index_renamed'
      }
    ]);

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
            name: 'table_index_renamed_sk',
            check: `SELECT 1 FROM "pg_index" WHERE "indexrelid" = 'table_index_renamed_sk'::regclass AND ("indisvalid" = false OR "indisready" = false)`,
            retry: `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" ILIKE '%' || '"table_index_renamed_sk"' || '%' LIMIT 1`
          }
        ],
        relations: [],
        indexes: [
          getRebuildIndexStatement('table_index_renamed_sk'),
          {
            query: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_index_renamed_sk" ON "table" USING BTREE ("column", "other")',
            concurrent: true
          }
        ]
      },
      cleanup: {
        tables: [],
        constraints: [],
        validations: [],
        relations: [],
        indexes: [
          {
            query: 'DROP INDEX CONCURRENTLY IF EXISTS "table_index_sk"',
            concurrent: true
          }
        ]
      }
    });
  });

  it('assert :: rename index (primary with table)', () => {
    const sourceTable = getDatabaseTables(singleColumn, [primaryIndex]);

    const targetTable = {
      renamed_table: {
        ...sourceTable.table,
        name: 'renamed_table'
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
            query: 'ALTER TABLE IF EXISTS "table" RENAME TO "renamed_table"'
          }
        ],
        constraints: [
          {
            check: `SELECT 1 FROM "pg_constraint" WHERE "conname" = 'renamed_table_index_pk'`,
            query: 'ALTER TABLE IF EXISTS "renamed_table" RENAME CONSTRAINT "table_index_pk" TO "renamed_table_index_pk"'
          }
        ],
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

  it('assert :: rename index (unique with table)', () => {
    const sourceTable = getDatabaseTables(singleColumn, [uniqueIndex]);

    const targetTable = {
      renamed_table: {
        ...sourceTable.table,
        name: 'renamed_table'
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
            query: 'ALTER TABLE IF EXISTS "table" RENAME TO "renamed_table"'
          }
        ],
        constraints: [],
        validations: [],
        relations: [],
        indexes: [
          {
            query: 'ALTER INDEX IF EXISTS "table_index_uk" RENAME TO "renamed_table_index_uk"'
          }
        ]
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

  it('assert :: rename index (secondary with table)', () => {
    const sourceTable = getDatabaseTables(singleColumn, [secondaryIndex]);

    const targetTable = {
      renamed_table: {
        ...sourceTable.table,
        name: 'renamed_table'
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
            query: 'ALTER TABLE IF EXISTS "table" RENAME TO "renamed_table"'
          }
        ],
        constraints: [],
        validations: [],
        relations: [],
        indexes: [
          {
            query: 'ALTER INDEX IF EXISTS "table_index_sk" RENAME TO "renamed_table_index_sk"'
          }
        ]
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

  it('assert :: rename index (primary with column)', () => {
    const sourceTable = getDatabaseTables(singleColumn, [primaryIndex]);

    const targetTable = getDatabaseTables(
      {
        renamed_column: singleColumn.column
      },
      [
        {
          ...primaryIndex,
          columns: ['renamed_column']
        }
      ]
    );

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
            check: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE "column_name" = 'column' AND "table_name" = 'table')`,
            query: 'ALTER TABLE IF EXISTS "table" RENAME COLUMN "column" TO "renamed_column"'
          }
        ],
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

  it('assert :: rename index (unique with column)', () => {
    const sourceTable = getDatabaseTables(singleColumn, [uniqueIndex]);

    const targetTable = getDatabaseTables(
      {
        renamed_column: singleColumn.column
      },
      [
        {
          ...uniqueIndex,
          columns: ['renamed_column']
        }
      ]
    );

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
            check: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE "column_name" = 'column' AND "table_name" = 'table')`,
            query: 'ALTER TABLE IF EXISTS "table" RENAME COLUMN "column" TO "renamed_column"'
          }
        ],
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

  it('assert :: rename index (secondary with column)', () => {
    const sourceTable = getDatabaseTables(singleColumn, [secondaryIndex]);

    const targetTable = getDatabaseTables(
      {
        renamed_column: singleColumn.column
      },
      [
        {
          ...secondaryIndex,
          columns: ['renamed_column']
        }
      ]
    );

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
            check: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE "column_name" = 'column' AND "table_name" = 'table')`,
            query: 'ALTER TABLE IF EXISTS "table" RENAME COLUMN "column" TO "renamed_column"'
          }
        ],
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
});
