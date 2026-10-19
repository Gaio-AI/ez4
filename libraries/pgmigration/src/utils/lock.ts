import type { PgMigrationStatement } from '../types/query';

/**
 * Long enough for a statement to get its lock on a busy table, short enough that a statement waiting
 * behind a long transaction doesn't keep every write to that table waiting behind it.
 */
export const MIGRATION_LOCK_TIMEOUT = '5s';

/**
 * The query to run for a migration statement. A statement that waits for a table lock makes every later
 * write to that table wait behind it, so it runs with a lock timeout and fails instead, to be retried. A
 * concurrent statement can't run inside a transaction block, and takes no lock that blocks writes.
 */
export const getMigrationQuery = (statement: PgMigrationStatement, lockTimeout = MIGRATION_LOCK_TIMEOUT) => {
  const { query, concurrent } = statement;

  if (concurrent) {
    return query;
  }

  const tag = getDollarQuoteTag(query);

  return `DO ${tag} BEGIN PERFORM set_config('lock_timeout', '${lockTimeout}', true); ${query}; END ${tag}`;
};

const getDollarQuoteTag = (query: string) => {
  let tag = '$ez4$';

  for (let index = 1; query.includes(tag); index++) {
    tag = `$ez4_${index}$`;
  }

  return tag;
};
