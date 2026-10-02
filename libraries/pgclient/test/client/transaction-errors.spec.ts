import type { Database } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';

import { after, before, beforeEach, describe, it } from 'node:test';
import { deepEqual, equal, match, ok, rejects } from 'node:assert/strict';

import { DuplicateUniqueKeyError, PgClient } from '@ez4/pgclient';
import { Client, ClientDriver, createPool } from '@ez4/pgclient/driver';

import { TestConnection } from './common/data-api';

declare class TestDb extends Database.Service<PostgresEngine> {
  tables: [];
}

const assertOriginalError = (expected: Error, rollbackFailed: boolean) => {
  return (error: unknown) => {
    equal(error, expected);

    const { rollbackError } = error as Error & { rollbackError?: unknown };

    if (rollbackFailed) {
      ok(rollbackError instanceof Error);
    } else {
      equal(rollbackError, undefined);
    }

    return true;
  };
};

describe('client transaction errors', () => {
  // A single connection makes every test below fail if a transaction doesn't give it back to the pool.
  const pool = createPool({ ...TestConnection, poolSize: 1 });

  // A connection terminated while it's checked out emits its error on the client, which the pool doesn't listen to.
  pool.on('connect', (connection) => {
    connection.on('error', () => {});
  });

  const driver = new ClientDriver(pool);

  const client = PgClient.make<TestDb>({
    repository: {},
    driver
  });

  const otherClient = Client.make<TestDb>({
    connection: TestConnection,
    repository: {}
  });

  const selectIds = async () => {
    const records = await client.rawQuery(`SELECT "id" FROM "ez4_test_transaction" ORDER BY "id"`);

    return records.map(({ id }) => id);
  };

  // Ends the connection from another one, so the next statement on it fails in the driver.
  const terminateConnection = async (pid: unknown) => {
    await otherClient.rawQuery('SELECT pg_terminate_backend(:pid::integer, 5000)', { pid });
  };

  before(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "ez4_test_transaction"`);

    // A deferred unique constraint is checked by COMMIT, not by the statement.
    await client.rawQuery(
      `CREATE TABLE "ez4_test_transaction" ("id" integer CONSTRAINT "ez4_test_transaction_id" UNIQUE DEFERRABLE INITIALLY DEFERRED)`
    );
  });

  beforeEach(async () => {
    await client.rawQuery(`TRUNCATE "ez4_test_transaction"`);
  });

  after(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "ez4_test_transaction"`);
    await pool.end();
  });

  it('assert :: transaction commit', async () => {
    const result = await client.transaction(async (transaction) => {
      await transaction.rawQuery(`INSERT INTO "ez4_test_transaction" VALUES (1), (2)`);

      return 'committed';
    });

    equal(result, 'committed');

    deepEqual(await selectIds(), [1, 2]);
  });

  it('assert :: transaction rollback', async () => {
    const operationError = new Error('Operation failed.');

    await rejects(
      client.transaction(async (transaction) => {
        await transaction.rawQuery(`INSERT INTO "ez4_test_transaction" VALUES (1)`);

        throw operationError;
      }),
      assertOriginalError(operationError, false)
    );

    deepEqual(await selectIds(), []);
  });

  it('assert :: transaction commit failure', async () => {
    await rejects(
      client.transaction(async (transaction) => {
        await transaction.rawQuery(`INSERT INTO "ez4_test_transaction" VALUES (1), (1)`);
      }),
      DuplicateUniqueKeyError
    );

    deepEqual(await selectIds(), []);
  });

  it('assert :: transaction rollback failure', async () => {
    const operationError = new Error('Operation failed.');

    await rejects(
      client.transaction(async (transaction) => {
        const [{ pid }] = await transaction.rawQuery('SELECT pg_backend_pid() AS pid');

        await terminateConnection(pid);

        throw operationError;
      }),
      assertOriginalError(operationError, true)
    );

    deepEqual(await selectIds(), []);
  });

  it('assert :: execute transaction commit', async () => {
    await driver.executeTransaction([
      { query: `INSERT INTO "ez4_test_transaction" VALUES (1)` },
      { query: `INSERT INTO "ez4_test_transaction" VALUES (2)` }
    ]);

    deepEqual(await selectIds(), [1, 2]);
  });

  it('assert :: execute transaction rollback', async () => {
    await rejects(
      driver.executeTransaction([
        { query: `INSERT INTO "ez4_test_transaction" VALUES (1)` },
        { query: `INSERT INTO "ez4_test_transaction" VALUES ('one')` }
      ]),
      (error: Error & { rollbackError?: unknown }) => {
        match(error.message, /invalid input syntax for type integer/);
        equal(error.rollbackError, undefined);
        return true;
      }
    );

    deepEqual(await selectIds(), []);
  });

  it('assert :: execute transaction commit failure', async () => {
    await rejects(driver.executeTransaction([{ query: `INSERT INTO "ez4_test_transaction" VALUES (1), (1)` }]), DuplicateUniqueKeyError);

    deepEqual(await selectIds(), []);
  });

  it('assert :: execute transaction rollback failure', async () => {
    await rejects(
      driver.executeTransaction([{ query: 'SELECT pg_terminate_backend(pg_backend_pid())' }]),
      (error: Error & { rollbackError?: unknown }) => {
        match(error.message, /terminating connection due to administrator command/);
        ok(error.rollbackError instanceof Error);
        return true;
      }
    );

    deepEqual(await selectIds(), []);
  });
});
