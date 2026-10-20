import type { PgMigrationStatement } from '@ez4/pgmigration/library';
import type { ExecuteStatementCommandOutput } from '@aws-sdk/client-rds-data';
import type { TestContext } from 'node:test';

import { describe, it } from 'node:test';
import { deepEqual, rejects } from 'node:assert/strict';
import { scheduler } from 'node:timers/promises';

import { DatabaseErrorException, ExecuteStatementCommand, RDSDataClient, StatementTimeoutException } from '@aws-sdk/client-rds-data';

import { modifyDatabase } from '../src/migration/client';

type StatementResult = Partial<ExecuteStatementCommandOutput> | Error;

const clusterArn = 'arn:aws:rds:us-east-1:000000000000:cluster:test';
const secretArn = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:test';

const logger = {
  update: () => {}
};

const alterQuery = `ALTER TABLE IF EXISTS "items" ADD COLUMN IF NOT EXISTS "other" text`;
const indexQuery = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "items_other_sk" ON "items" USING BTREE ("other")`;
const assertQuery = `SELECT 1 FROM "items" WHERE NOT "status" IN ('a', 'b') LIMIT 1`;

const lockedAlterQuery = `DO $ez4$ BEGIN PERFORM set_config('lock_timeout', '5s', true); ${alterQuery}; END $ez4$`;

// Answers each statement with its listed results in order, and records every statement sent.
const mockDataApi = (t: TestContext, results: Record<string, StatementResult[]>) => {
  const statements: string[] = [];

  t.mock.method(RDSDataClient.prototype, 'send', async (command: ExecuteStatementCommand) => {
    const sql = command.input.sql ?? '';

    statements.push(sql);

    const result = results[sql]?.shift() ?? {};

    if (result instanceof Error) {
      throw result;
    }

    return result;
  });

  return statements;
};

const getLockTimeoutError = () => {
  return new DatabaseErrorException({
    $metadata: {},
    message: 'ERROR: canceling statement due to lock timeout; SQLState: 55P03'
  });
};

const modify = (statements: PgMigrationStatement[]) => {
  return modifyDatabase(logger, { clusterArn, secretArn, database: 'test', statements });
};

describe('aurora migration client', () => {
  it('assert :: statement runs with a lock timeout, a concurrent one as it is', async (t) => {
    const statements = mockDataApi(t, {});

    await modify([{ query: alterQuery }, { query: indexQuery, concurrent: true }]);

    deepEqual(statements, [lockedAlterQuery, indexQuery]);
  });

  it('assert :: statement that times out on its lock is retried', async (t) => {
    const statements = mockDataApi(t, {
      [lockedAlterQuery]: [getLockTimeoutError()]
    });

    await modify([{ query: alterQuery }]);

    deepEqual(statements, [lockedAlterQuery, lockedAlterQuery]);
  });

  it('assert :: statement that outlasts its call is waited for before the next one', async (t) => {
    t.mock.method(scheduler, 'wait', async () => {});

    const runningQuery =
      `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() ` +
      `AND starts_with("query", '${lockedAlterQuery.replaceAll("'", "''")}')`;

    const stillRunning = {
      columnMetadata: [{ name: 'running' }],
      records: [[{ longValue: 1 }]]
    };

    const statements = mockDataApi(t, {
      [lockedAlterQuery]: [new StatementTimeoutException({ $metadata: {}, message: 'timeout' })],
      [runningQuery]: [stillRunning, stillRunning, {}]
    });

    await modify([{ query: alterQuery }, { query: indexQuery, concurrent: true }]);

    deepEqual(statements, [lockedAlterQuery, runningQuery, runningQuery, runningQuery, indexQuery]);
  });

  it('assert :: statement still running stops the migration', async (t) => {
    t.mock.method(scheduler, 'wait', async () => {});

    const runningQuery =
      `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() ` +
      `AND starts_with("query", '${indexQuery}')`;

    const stillRunning = {
      columnMetadata: [{ name: 'running' }],
      records: [[{ longValue: 1 }]]
    };

    const statements = mockDataApi(t, {
      [indexQuery]: [new StatementTimeoutException({ $metadata: {}, message: 'timeout' })],
      [runningQuery]: Array(480).fill(stillRunning)
    });

    await rejects(modify([{ query: indexQuery, concurrent: true }, { query: alterQuery }]), /Statement still running in the database/);

    deepEqual(statements.at(-1), runningQuery);
    deepEqual(statements.includes(lockedAlterQuery), false);
  });

  it('assert :: assert that times out leaves the check to the statement', async (t) => {
    const statements = mockDataApi(t, {
      [assertQuery]: [new StatementTimeoutException({ $metadata: {}, message: 'timeout' })]
    });

    await modify([{ query: alterQuery, assert: assertQuery }]);

    deepEqual(statements, [assertQuery, lockedAlterQuery]);
  });
});
