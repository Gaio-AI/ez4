import { after, describe, it } from 'node:test';
import { deepEqual, rejects } from 'node:assert/strict';

import { ClientDriver, createPool } from '@ez4/pgclient/driver';

import { makeDataApiClient, TestConnection } from './common/data-api';

const STATEMENT_TIMEOUT_ERROR = {
  name: 'StatementTimeoutException',
  message: 'canceling statement due to statement timeout'
};

const getStatementTimeout = async (driver: ClientDriver) => {
  const { records } = await driver.executeStatement({ query: 'SHOW statement_timeout' });

  return records;
};

describe('client data api statement timeout', () => {
  const client = makeDataApiClient({ statementTimeout: 1000 });

  // A single connection makes every driver below share the same session.
  const pool = createPool({ ...TestConnection, poolSize: 1 });

  const dataApiDriver = new ClientDriver(pool, { dataApi: { statementTimeout: 1000 } });
  const defaultDriver = new ClientDriver(pool);

  after(async () => {
    await pool.end();
  });

  it('assert :: statement timeout', async () => {
    await rejects(client.rawQuery('SELECT pg_sleep(2)'), STATEMENT_TIMEOUT_ERROR);
  });

  it('assert :: statement timeout (transaction)', async () => {
    await rejects(
      client.transaction(async (transaction) => {
        return transaction.rawQuery('SELECT pg_sleep(2)');
      }),
      STATEMENT_TIMEOUT_ERROR
    );
  });

  it('assert :: default statement timeout', async () => {
    const result = await makeDataApiClient().rawQuery('SHOW statement_timeout');

    deepEqual(result, [{ statement_timeout: '45s' }]);
  });

  it('assert :: no statement timeout', async () => {
    const { records } = await dataApiDriver.executeStatement({ query: 'SHOW statement_timeout' }, { noTimeout: true });

    deepEqual(records, [{ statement_timeout: '0' }]);

    await dataApiDriver.executeStatement({ query: 'SELECT pg_sleep(1.5)' }, { noTimeout: true });
  });

  it('assert :: statement timeout inside transaction', async () => {
    const [{ records }] = await dataApiDriver.executeTransaction([{ query: 'SHOW statement_timeout' }]);

    deepEqual(records, [{ statement_timeout: '1s' }]);
  });

  it('assert :: statement timeout is not left on the connection', async () => {
    await dataApiDriver.executeStatement({ query: 'SELECT 1' });

    deepEqual(await getStatementTimeout(defaultDriver), [{ statement_timeout: '0' }]);

    await rejects(dataApiDriver.executeStatement({ query: 'SELECT pg_sleep(2)' }), STATEMENT_TIMEOUT_ERROR);

    deepEqual(await getStatementTimeout(defaultDriver), [{ statement_timeout: '0' }]);
  });

  it('assert :: statement timeout is not left on the connection (transaction)', async () => {
    await dataApiDriver.executeTransaction([{ query: 'SELECT 1' }, { query: 'SELECT 2' }]);

    deepEqual(await getStatementTimeout(defaultDriver), [{ statement_timeout: '0' }]);

    await rejects(dataApiDriver.executeTransaction([{ query: 'SELECT 1' }, { query: 'SELECT pg_sleep(2)' }]), STATEMENT_TIMEOUT_ERROR);

    deepEqual(await getStatementTimeout(defaultDriver), [{ statement_timeout: '0' }]);
  });
});
