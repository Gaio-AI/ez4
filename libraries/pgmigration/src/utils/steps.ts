import type { PgMigrationQueries, PgMigrationStatement, PgMigrationStep } from '../types/query';

/**
 * The statements of a migration step in the order they run. A foreign key needs the key it references,
 * so the steps that build run the relations after the indexes. The cleanup drops what the migration no
 * longer declares, and Postgres keeps a key or a column while a foreign key references it, so the
 * cleanup drops and replaces the foreign keys first.
 */
export const getStepStatements = (queries: PgMigrationQueries, step: PgMigrationStep): PgMigrationStatement[] => {
  const { tables, constraints, indexes, relations } = queries;

  if (step === 'cleanup') {
    return [...relations, ...tables, ...constraints, ...indexes];
  }

  return [...tables, ...constraints, ...indexes, ...relations];
};
