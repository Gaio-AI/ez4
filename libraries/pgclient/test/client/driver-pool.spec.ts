import type { Socket } from 'node:net';

import { describe, it } from 'node:test';
import { equal, rejects } from 'node:assert/strict';

import { ClientDriver, createPool } from '@ez4/pgclient/driver';

import { TestConnection } from './common/data-api';

describe('client driver pool', () => {
  it('assert :: default pool size', async () => {
    const pool = createPool(TestConnection);

    equal(pool.options.max, 2);

    await pool.end();
  });

  it('assert :: custom pool size', async () => {
    const pool = createPool({ ...TestConnection, poolSize: 5 });

    equal(pool.options.max, 5);

    await pool.end();
  });

  it('assert :: custom pool size (connection string)', async () => {
    const pool = createPool({ database: 'postgres', connectionString: 'postgres://postgres:postgres@127.0.0.1/postgres', poolSize: 3 });

    equal(pool.options.max, 3);

    await pool.end();
  });

  it('assert :: idle connection closed by the server', async (context) => {
    const warn = context.mock.method(console, 'warn', () => {});

    const pool = createPool(TestConnection);

    const client = await pool.connect();
    const { rows } = await client.query('SELECT pg_backend_pid() AS pid');

    client.release();

    // The server ends the idle connection, as an idle session timeout, a restart or a proxy would.
    const admin = createPool(TestConnection);

    await admin.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
    await admin.end();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await pool.query('SELECT 1 AS one');

    equal(result.rows[0].one, 1);

    equal(warn.mock.callCount(), 1);
    equal(warn.mock.calls[0].arguments[0].idleConnectionEnded.code, '57P01');

    await pool.end();
  });

  it('assert :: connection dropped during a statement', async (context) => {
    context.mock.method(console, 'error', () => {});

    const pool = createPool(TestConnection);
    const driver = new ClientDriver(pool);

    // The socket closes with no error response from the server, as when a proxy or a restarting database drops
    // the connection while the statement runs.
    pool.once('acquire', (client) => {
      const stream: Socket = Reflect.get(Reflect.get(client, 'connection'), 'stream');

      setTimeout(() => stream.destroy(), 100);
    });

    await rejects(driver.executeStatement({ query: 'SELECT pg_sleep(5)' }), /Connection terminated unexpectedly/);

    const { records } = await driver.executeStatement({ query: 'SELECT 1 AS one' });

    equal(records[0]?.one, 1);

    await pool.end();
  });

  it('assert :: one error listener on every checkout', async () => {
    const pool = createPool({ ...TestConnection, poolSize: 1 });

    for (let checkout = 0; checkout < 20; checkout++) {
      const client = await pool.connect();

      equal(client.listenerCount('error'), 1);

      client.release();
    }

    await pool.end();
  });

  it('assert :: default idle timeout', async () => {
    const pool = createPool(TestConnection);

    equal(pool.options.idleTimeoutMillis, 15000);

    await pool.end();
  });

  it('assert :: custom idle timeout', async () => {
    const pool = createPool({ ...TestConnection, idleTimeout: 300000 });

    equal(pool.options.idleTimeoutMillis, 300000);

    await pool.end();
  });

  it('assert :: password function for each new connection', async () => {
    let calls = 0;

    const pool = createPool({
      ...TestConnection,
      poolSize: 2,
      password: async () => {
        calls++;
        return TestConnection.password;
      }
    });

    const [first, second] = await Promise.all([pool.connect(), pool.connect()]);

    first.release();
    second.release();

    const result = await pool.query('SELECT 1 AS one');

    equal(result.rows[0].one, 1);
    equal(calls, 2);

    await pool.end();
  });
});
