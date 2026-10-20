// Statements that every index change emits around the index it builds.

export const getRebuildIndexStatement = (name: string) => {
  return {
    check:
      `SELECT 1 WHERE (NOT EXISTS (SELECT 1 FROM "pg_index" WHERE "indexrelid" = to_regclass('"${name}"') ` +
      `AND ("indisvalid" = false OR "indisready" = false)) OR EXISTS (SELECT 1 FROM "pg_stat_activity" ` +
      `WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" ILIKE '%' || '"${name}"' || '%'))`,
    query: `DROP INDEX CONCURRENTLY IF EXISTS "${name}"`,
    condition: 'only when the index is invalid',
    concurrent: true
  };
};

export const getIndexValidation = (name: string) => {
  return {
    check: `SELECT 1 FROM "pg_index" WHERE "indexrelid" = '${name}'::regclass AND ("indisvalid" = false OR "indisready" = false)`,
    retry: `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" ILIKE '%' || '"${name}"' || '%' LIMIT 1`,
    name
  };
};

export const getPrimaryKeySwapStatements = (table: string, temporaryName: string, targetName: string, sourceName?: string) => {
  const dropSource = sourceName ? `DROP CONSTRAINT IF EXISTS "${sourceName}", ` : '';

  return [
    {
      check:
        `SELECT 1 WHERE (EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = '${temporaryName}') ` +
        `OR NOT EXISTS (SELECT 1 FROM "pg_class" WHERE "relname" = '${temporaryName}' AND "relkind" = 'i'))`,
      query: `ALTER TABLE IF EXISTS "${table}" ${dropSource}ADD CONSTRAINT "${temporaryName}" PRIMARY KEY USING INDEX "${temporaryName}"`
    },
    {
      check: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = '${temporaryName}')`,
      query: `ALTER TABLE IF EXISTS "${table}" RENAME CONSTRAINT "${temporaryName}" TO "${targetName}"`
    }
  ];
};
