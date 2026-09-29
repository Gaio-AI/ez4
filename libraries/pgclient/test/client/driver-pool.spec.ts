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
});
