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

  /**
   * When a statement that its check usually skips runs. The deploy plan prints the query without the
   * check, so a drop that only rebuilds an invalid index would otherwise read as dropping the index.
   */
  condition?: string;
};

export type PgValidationStatement = {
  name: string;
  check: string;
  retry: string;
};

export type PgMigrationQueries = {
  tables: PgMigrationStatement[];

  /**
   * The functions and triggers that write the table timestamps, with the column defaults that go with them.
   * Only a migration that changes timestamps has them.
   */
  triggers?: PgMigrationStatement[];

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
