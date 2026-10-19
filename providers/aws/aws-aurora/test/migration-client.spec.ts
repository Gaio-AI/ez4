import type { PgMigrationQueries } from '@ez4/pgmigration/library';
import type { ExecuteStatementCommandOutput } from '@aws-sdk/client-rds-data';
import type { TestContext } from 'node:test';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

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

const getQueries = (queries: Partial<PgMigrationQueries>): PgMigrationQueries => {
  return {
    tables: [],
    constraints: [],
    validations: [],
    relations: [],
    indexes: [],
    ...queries
  };
};

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

const modify = (queries: PgMigrationQueries) => {
  return modifyDatabase(logger, { clusterArn, secretArn, database: 'test', queries });
};

describe('aurora migration client', () => {
  it('assert :: statement runs with a lock timeout, a concurrent one as it is', async (t) => {
    const statements = mockDataApi(t, {});

    await modify(
      getQueries({
        tables: [{ query: alterQuery }],
        indexes: [{ query: indexQuery, concurrent: true }]
      })
    );

    deepEqual(statements, [lockedAlterQuery, indexQuery]);
  });

  it('assert :: statement that times out on its lock is retried', async (t) => {
    const statements = mockDataApi(t, {
      [lockedAlterQuery]: [getLockTimeoutError()]
    });

    await modify(getQueries({ tables: [{ query: alterQuery }] }));

    deepEqual(statements, [lockedAlterQuery, lockedAlterQuery]);
  });

  it('assert :: assert that times out leaves the check to the statement', async (t) => {
    const statements = mockDataApi(t, {
      [assertQuery]: [new StatementTimeoutException({ $metadata: {}, message: 'timeout' })]
    });

    await modify(getQueries({ tables: [{ query: alterQuery, assert: assertQuery }] }));

    deepEqual(statements, [assertQuery, lockedAlterQuery]);
  });
});
