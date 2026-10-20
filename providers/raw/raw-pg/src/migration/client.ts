import type { Database, Client as DbClient } from '@ez4/database';
import type { PgMigrationStatement, PgValidationStatement } from '@ez4/pgmigration/library';
import type { PgTableRepository } from '@ez4/pgclient/library';

import { getDeleteQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import {
  getMigrationQuery,
  getStepStatements,
  MigrationAssertionFailedError,
  MigrationValidationFailedError
} from '@ez4/pgmigration/library';
import { Client } from '@ez4/pgclient/driver';
import { Wait } from '@ez4/utils';

import { MissingConnectionStringError } from '../common/errors';

type ApplyContext = {
  envName: string;
  database: string;
  repository: PgTableRepository;
};

const getConnection = ({ envName, database }: ApplyContext) => {
  const connectionString = process.env[envName];

  if (!connectionString) {
    throw new MissingConnectionStringError(envName, database);
  }

  return Client.make({
    debug: false,
    repository: {},
    connection: { database, connectionString }
  });
};

export const createTables = async (context: ApplyContext) => {
  return applyStepQueries(context, {});
};

export const updateTables = async (context: ApplyContext, statements: PgMigrationStatement[]) => {
  const client = getConnection(context);

  await runAllStatements(client, statements);
};

export const validateTables = async (context: ApplyContext, validations: PgValidationStatement[]) => {
  const client = getConnection(context);

  await runAllValidations(client, validations);
};

export const deleteTables = async (context: ApplyContext) => {
  const client = getConnection(context);
  const queries = getDeleteQueries(context.repository);

  await runAllStatements(client, queries.tables);
};

const applyStepQueries = async (context: ApplyContext, oldRepository: PgTableRepository) => {
  const steps = getUpdateStepQueries(context.repository, oldRepository);
  const client = getConnection(context);

  await runAllStatements(client, [
    ...getStepStatements(steps.prepare, 'prepare'),
    ...getStepStatements(steps.rollout, 'rollout'),
    ...getStepStatements(steps.cleanup, 'cleanup')
  ]);

  const validations = [...steps.prepare.validations, ...steps.rollout.validations, ...steps.cleanup.validations];

  await runAllValidations(client, validations);
};

const runAllStatements = async (client: DbClient<Database.Service<any>>, statements: PgMigrationStatement[]) => {
  for (const statement of statements) {
    await runStatement(client, { ...statement, query: getMigrationQuery(statement) });
  }
};

const runAllValidations = async (client: DbClient<Database.Service<any>>, validations: PgValidationStatement[]) => {
  for (const { name, check } of validations) {
    const [hasError] = await client.rawQuery(check);

    if (hasError) {
      throw new MigrationValidationFailedError(name);
    }
  }
};

const runStatement = async (client: DbClient<Database.Service<any>>, statement: PgMigrationStatement) => {
  const { name, assert, check, query } = statement;

  if (assert) {
    const [shouldFail] = await client.rawQuery(assert);

    if (shouldFail) {
      throw new MigrationAssertionFailedError(name);
    }
  }

  if (check) {
    const [shouldSkip] = await client.rawQuery(check);

    if (shouldSkip) {
      return false;
    }
  }

  await Wait.until(
    async () => {
      try {
        return await client.rawQuery(query);
      } catch (error) {
        if (isLockTimeoutError(error)) {
          return Wait.RetryAttempt;
        }

        throw error;
      }
    },
    {
      minDelay: 1,
      maxDelay: 15,
      attempts: 10
    }
  );

  return true;
};

const isLockTimeoutError = (error: unknown) => {
  return error instanceof Error && Reflect.get(error, 'code') === '55P03';
};
