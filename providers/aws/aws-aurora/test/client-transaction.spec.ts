import type { Database, Client as DbClient } from '@ez4/database';
import type { PostgresEngine } from '@ez4/aws-aurora/client';
import type { TestContext } from 'node:test';

import { describe, it } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';

import { DatabaseErrorException, InternalServerErrorException, RDSDataClient } from '@aws-sdk/client-rds-data';
import { DuplicateUniqueKeyError } from '@ez4/pgclient';

import { ApiClientDriver } from '../src/client/drivers/api';
import { Client } from '../src/client/providers/api';

declare class TestDb extends Database.Service<PostgresEngine> {
  tables: [];
}

type CommandName = 'BeginTransactionCommand' | 'ExecuteStatementCommand' | 'CommitTransactionCommand' | 'RollbackTransactionCommand';

type CommandFailures = Partial<Record<CommandName, Error>>;

const connection = {
  resourceArn: 'arn:aws:rds:us-east-1:000000000000:cluster:ez4-test',
  secretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:ez4-test',
  database: 'ez4_test'
} as const;

const statement = {
  query: 'INSERT INTO "ez4_test_transaction" VALUES (1)'
};

const getDuplicateKeyException = () => {
  return new DatabaseErrorException({
    message: 'ERROR: duplicate key value violates unique constraint "ez4_test_transaction_id"; SQLState: 23505',
    $metadata: {}
  });
};

const getInternalServerException = () => {
  return new InternalServerErrorException({
    message: 'Internal server error.',
    $metadata: {}
  });
};

const mockDataApi = (t: TestContext, failures: CommandFailures = {}) => {
  return t.mock.method(RDSDataClient.prototype, 'send', async (command: object) => {
    const failure = failures[command.constructor.name as CommandName];

    if (failure) {
      throw failure;
    }

    switch (command.constructor.name) {
      case 'BeginTransactionCommand':
        return { transactionId: 'ez4-test-transaction' };

      case 'ExecuteStatementCommand':
        return { numberOfRecordsUpdated: 1 };

      default:
        return {};
    }
  });
};

const getSentCommands = (send: ReturnType<typeof mockDataApi>) => {
  return send.mock.calls.map(({ arguments: [command] }) => (command as object).constructor.name);
};

const assertOriginalError = (expected: Error | typeof DuplicateUniqueKeyError, rollbackError?: Error) => {
  return (error: Error & { rollbackError?: unknown }) => {
    if (expected instanceof Error) {
      equal(error, expected);
    } else {
      equal(error.constructor, expected);
    }

    equal(error.rollbackError, rollbackError);

    return true;
  };
};

describe('aurora client transaction', () => {
  const driver = new ApiClientDriver(connection);

  const client: DbClient<TestDb> = Client.make<TestDb>({
    repository: {},
    connection
  });

  it('assert :: execute transaction commit', async (t) => {
    const send = mockDataApi(t);

    const results = await driver.executeTransaction([statement, statement]);

    deepEqual(results, [
      { rows: 1, records: [] },
      { rows: 1, records: [] }
    ]);

    deepEqual(getSentCommands(send), [
      'BeginTransactionCommand',
      'ExecuteStatementCommand',
      'ExecuteStatementCommand',
      'CommitTransactionCommand'
    ]);
  });

  it('assert :: execute transaction rollback', async (t) => {
    const send = mockDataApi(t, {
      ExecuteStatementCommand: getDuplicateKeyException()
    });

    await rejects(driver.executeTransaction([statement]), assertOriginalError(DuplicateUniqueKeyError));

    deepEqual(getSentCommands(send), ['BeginTransactionCommand', 'ExecuteStatementCommand', 'RollbackTransactionCommand']);
  });

  it('assert :: execute transaction commit failure', async (t) => {
    const send = mockDataApi(t, {
      CommitTransactionCommand: getDuplicateKeyException()
    });

    await rejects(driver.executeTransaction([statement]), assertOriginalError(DuplicateUniqueKeyError));

    deepEqual(getSentCommands(send), ['BeginTransactionCommand', 'ExecuteStatementCommand', 'CommitTransactionCommand']);
  });

  it('assert :: execute transaction rollback failure', async (t) => {
    const rollbackError = getInternalServerException();

    const send = mockDataApi(t, {
      ExecuteStatementCommand: getDuplicateKeyException(),
      RollbackTransactionCommand: rollbackError
    });

    await rejects(driver.executeTransaction([statement]), assertOriginalError(DuplicateUniqueKeyError, rollbackError));

    deepEqual(getSentCommands(send), ['BeginTransactionCommand', 'ExecuteStatementCommand', 'RollbackTransactionCommand']);
  });

  it('assert :: transaction commit failure', async (t) => {
    const send = mockDataApi(t, {
      CommitTransactionCommand: getDuplicateKeyException()
    });

    await rejects(
      client.transaction(async (transaction) => {
        await transaction.rawQuery(statement.query);
      }),
      assertOriginalError(DuplicateUniqueKeyError)
    );

    deepEqual(getSentCommands(send), ['BeginTransactionCommand', 'ExecuteStatementCommand', 'CommitTransactionCommand']);
  });

  it('assert :: transaction rollback failure', async (t) => {
    const operationError = new Error('Operation failed.');
    const rollbackError = getInternalServerException();

    const send = mockDataApi(t, {
      RollbackTransactionCommand: rollbackError
    });

    await rejects(
      client.transaction(async (transaction) => {
        await transaction.rawQuery(statement.query);

        throw operationError;
      }),
      assertOriginalError(operationError, rollbackError)
    );

    deepEqual(getSentCommands(send), ['BeginTransactionCommand', 'ExecuteStatementCommand', 'RollbackTransactionCommand']);
  });
});
