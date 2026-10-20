export type PgMigrationStatement = {
  name?: string;
  check?: string;
  assert?: string;
  query: string;

  /**
   * Whether the query runs concurrently (`CREATE INDEX CONCURRENTLY`), which can't run inside a
   * transaction block.
   */
  concurrent?: boolean;
};

export type PgValidationStatement = {
  name: string;
  check: string;
  retry: string;
};

export type PgMigrationQueries = {
  tables: PgMigrationStatement[];
  constraints: PgMigrationStatement[];
  validations: PgValidationStatement[];
  relations: PgMigrationStatement[];
  indexes: PgMigrationStatement[];
};

export type PgMigrationSteps = {
  prepare: PgMigrationQueries;
  rollout: PgMigrationQueries;
  cleanup: PgMigrationQueries;
};

export type PgMigrationStep = keyof PgMigrationSteps;
