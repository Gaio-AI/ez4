import type { PgMigrationStatement } from '@ez4/pgmigration/library';
import type { PgExecuteOptions, PgExecuteStatement } from '@ez4/pgclient';
import type { Arn, OperationLogLine } from '@ez4/aws-common';

import { DatabaseQueries, getMigrationQuery, MigrationAssertionFailedError } from '@ez4/pgmigration/library';
import { StatementTimeoutException } from '@aws-sdk/client-rds-data';
import { Wait } from '@ez4/utils';

import { isDeadlockException, isLockTimeoutException } from '../client/errors';
import { ApiClientDriver } from '../client/drivers/api';
import { MigrationFailedError } from './errors';

export type ConnectionRequest = {
  database: string;
  clusterArn: Arn;
  secretArn: Arn;
};

export type ModifyDatabaseRequest = ConnectionRequest & {
  statements: PgMigrationStatement[];
};

export const createDatabase = async (logger: OperationLogLine, request: ConnectionRequest): Promise<void> => {
  logger.update(`Creating database`);

  const { clusterArn, secretArn, database } = request;

  const driver = new ApiClientDriver({
    database: 'postgres',
    resourceArn: clusterArn,
    secretArn
  });

  const statement = DatabaseQueries.prepareCreate(database);

  await executeMigrationStatement(driver, statement);
};

export const modifyDatabase = async (logger: OperationLogLine, request: ModifyDatabaseRequest): Promise<void> => {
  logger.update(`Modifying database`);

  const { clusterArn, secretArn, database, statements } = request;

  const driver = new ApiClientDriver({
    resourceArn: clusterArn,
    secretArn,
    database
  });

  await executeMigrationStatements(driver, statements);
};

export const deleteDatabase = async (logger: OperationLogLine, request: ConnectionRequest): Promise<void> => {
  logger.update(`Deleting database`);

  const { clusterArn, secretArn, database } = request;

  const driver = new ApiClientDriver({
    database: 'postgres',
    resourceArn: clusterArn,
    secretArn
  });

  const statement = DatabaseQueries.prepareDelete(database);

  await executeMigrationStatement(driver, statement);
};

const executeMigrationStatements = async (driver: ApiClientDriver, statements: PgMigrationStatement[]) => {
  const errors = [];

  const options: PgExecuteOptions = {
    noErrorLog: true
  };

  for (const statement of statements) {
    try {
      await executeMigrationStatement(driver, { ...statement, query: getMigrationQuery(statement) }, options);
    } catch (error) {
      errors.push(`${error}`);
    }
  }

  if (errors.length > 0) {
    throw new MigrationFailedError(errors);
  }
};

const executeMigrationStatement = async (driver: ApiClientDriver, statement: PgMigrationStatement, options?: PgExecuteOptions) => {
  const { name, check, assert, query } = statement;

  if (assert && (await isAssertionFailed(driver, assert, options))) {
    throw new MigrationAssertionFailedError(name);
  }

  if (check) {
    const { records } = await driver.executeStatement({ query: check }, options);

    const [shouldSkip] = records;

    if (shouldSkip) {
      return false;
    }
  }

  try {
    await executeWithRetry(driver, { query }, options);
  } catch (error) {
    if (!(error instanceof StatementTimeoutException)) {
      throw error;
    }
  }

  return true;
};

// An assert only fails the migration before the statement does: the statement, or the validation after it,
// fails on the same records. So an assert that can't finish in time (a scan of a large table) is skipped.
const isAssertionFailed = async (driver: ApiClientDriver, assert: string, options?: PgExecuteOptions) => {
  try {
    const { records } = await driver.executeStatement({ query: assert }, options);

    return records.length > 0;
  } catch (error) {
    if (error instanceof StatementTimeoutException) {
      return false;
    }

    throw error;
  }
};

const executeWithRetry = (driver: ApiClientDriver, query: PgExecuteStatement, options?: PgExecuteOptions) => {
  return Wait.until(
    async () => {
      try {
        return await driver.executeStatement(query, {
          ...options,
          noTimeout: true
        });
      } catch (error) {
        if (isDeadlockException(error) || isLockTimeoutException(error)) {
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
};
