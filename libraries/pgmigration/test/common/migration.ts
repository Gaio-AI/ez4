import type { PgMigrationQueries, PgMigrationStatement, PgMigrationStep, PgValidationStatement } from '@ez4/pgmigration/library';
import type { Database, Client as DbClient } from '@ez4/database';

import {
  getMigrationQuery,
  getStepStatements,
  MigrationAssertionFailedError,
  MigrationValidationFailedError
} from '@ez4/pgmigration/library';

export const runMigration = async (
  client: DbClient<Database.Service<any>>,
  queries: PgMigrationQueries,
  step: PgMigrationStep = 'prepare'
) => {
  await runStatements(client, getStepStatements(queries, step));

  await runValidations(client, queries.validations);
};

const runStatements = async (client: DbClient<Database.Service<any>>, statements: PgMigrationStatement[]) => {
  for (const statement of statements) {
    const { name, assert, check } = statement;

    if (assert) {
      const [shouldFail] = await client.rawQuery(assert);

      if (shouldFail) {
        throw new MigrationAssertionFailedError(name);
      }
    }

    if (check) {
      const [shouldSkip] = await client.rawQuery(check);

      if (shouldSkip) {
        continue;
      }
    }

    await client.rawQuery(getMigrationQuery(statement));
  }
};

const runValidations = async (client: DbClient<Database.Service<any>>, validations: PgValidationStatement[]) => {
  for (const { name, check } of validations) {
    const [hasError] = await client.rawQuery(check);

    if (hasError) {
      throw new MigrationValidationFailedError(name);
    }
  }
};
