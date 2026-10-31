import type { PgMigrationStatement } from '@ez4/pgmigration/library';
import type { PgClientDriver, PgExecuteOptions, PgExecuteStatement } from '@ez4/pgclient';
import type { Arn, OperationLogLine } from '@ez4/aws-common';

import { DatabaseQueries, getMigrationQuery, MigrationAssertionFailedError } from '@ez4/pgmigration/library';
import { StatementTimeoutException } from '@aws-sdk/client-rds-data';
import { Wait, WaitMaxAttemptsError } from '@ez4/utils';

import { isDeadlockException, isLockTimeoutException } from '../client/errors';
import { getDeployDriver } from '../utils/connection';
import { MigrationFailedError, MigrationStatementRunningError } from './errors';

// Enough of a statement to tell it apart, and short enough to fit what Postgres keeps of its text.
const RUNNING_QUERY_PREFIX = 200;

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

  const driver = await getDeployDriver({
    database: 'postgres',
    clusterArn,
    secretArn
  });

  const statement = DatabaseQueries.prepareCreate(database);

  await executeMigrationStatement(driver, statement);
};

export const modifyDatabase = async (logger: OperationLogLine, request: ModifyDatabaseRequest): Promise<void> => {
  logger.update(`Modifying database`);

  const { clusterArn, secretArn, database, statements } = request;

  const driver = await getDeployDriver({
    clusterArn,
    secretArn,
    database
  });

  await executeMigrationStatements(driver, statements);
};

export const deleteDatabase = async (logger: OperationLogLine, request: ConnectionRequest): Promise<void> => {
  logger.update(`Deleting database`);

  const { clusterArn, secretArn, database } = request;

  const driver = await getDeployDriver({
    database: 'postgres',
    clusterArn,
    secretArn
  });

  const statement = DatabaseQueries.prepareDelete(database);

  await executeMigrationStatement(driver, statement);
};

const executeMigrationStatements = async (driver: PgClientDriver, statements: PgMigrationStatement[]) => {
  const errors = [];

  const options: PgExecuteOptions = {
    noErrorLog: true
  };

  for (const statement of statements) {
    try {
      await executeMigrationStatement(driver, { ...statement, query: getMigrationQuery(statement) }, options);
    } catch (error) {
      errors.push(`${error}`);

      // The next statements would run alongside the one still running.
      if (error instanceof MigrationStatementRunningError) {
        break;
      }
    }
  }

  if (errors.length > 0) {
    throw new MigrationFailedError(errors);
  }
};

const executeMigrationStatement = async (driver: PgClientDriver, statement: PgMigrationStatement, options?: PgExecuteOptions) => {
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

    await waitForStatement(driver, query, options);
  }

  return true;
};

// The Data API stops waiting for a statement after 45 s while the database keeps running it. The migration runs
// its statements one after another: a concurrent index build that starts while another one on the same table is
// still running deadlocks with it, and Postgres leaves one of the two indexes invalid. So the next statement
// waits for this one to end, found by the start of its text (Postgres keeps only the start of a long one).
const waitForStatement = async (driver: PgClientDriver, query: string, options?: PgExecuteOptions) => {
  const queryStart = query.slice(0, RUNNING_QUERY_PREFIX).replaceAll("'", "''");

  const runningQuery =
    `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() ` +
    `AND starts_with("query", '${queryStart}')`;

  try {
    await Wait.until(
      async () => {
        const { records } = await driver.executeStatement({ query: runningQuery }, options);

        return records.length > 0 ? Wait.RetryAttempt : true;
      },
      {
        minDelay: 5,
        maxDelay: 30,
        attempts: 480
      }
    );
  } catch (error) {
    if (error instanceof WaitMaxAttemptsError) {
      throw new MigrationStatementRunningError(query);
    }

    throw error;
  }
};

// An assert only fails the migration before the statement does: the statement, or the validation after it,
// fails on the same records. So an assert that can't finish in time (a scan of a large table) is skipped.
const isAssertionFailed = async (driver: PgClientDriver, assert: string, options?: PgExecuteOptions) => {
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

const executeWithRetry = (driver: PgClientDriver, query: PgExecuteStatement, options?: PgExecuteOptions) => {
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
