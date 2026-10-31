import type { PgMigrationQueries, PgMigrationStatement, PgMigrationStep } from '../types/query';

/**
 * The statements of a migration step in the order they run. A foreign key needs the key it references,
 * so the steps that build run the relations after the indexes. The cleanup drops what the migration no
 * longer declares, and Postgres keeps a key or a column while a foreign key references it, so the
 * cleanup drops and replaces the foreign keys first. A timestamp trigger writes its column by name when
 * it runs, not when it's created, so the steps that build create it once its table and columns exist,
 * and the cleanup drops it before the columns.
 */
export const getStepStatements = (queries: PgMigrationQueries, step: PgMigrationStep): PgMigrationStatement[] => {
  const { tables, triggers = [], constraints, indexes, relations } = queries;

  if (step === 'cleanup') {
    return [...relations, ...triggers, ...tables, ...constraints, ...indexes];
  }

  return [...tables, ...triggers, ...constraints, ...indexes, ...relations];
};
