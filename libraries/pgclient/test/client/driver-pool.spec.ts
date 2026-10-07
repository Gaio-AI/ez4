import { describe, it } from 'node:test';
import { equal } from 'node:assert/strict';

import { createPool } from '@ez4/pgclient/driver';

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
