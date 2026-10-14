import type { Database } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { Client } from '@ez4/pgclient/driver';

import { TestConnection } from './common/data-api';

declare class TestDb extends Database.Service<PostgresEngine> {
  tables: [];
}

const RESULTS_QUERY = `SELECT count(*) AS "count", '2026-09-17 20:08:20.8-03'::timestamptz AS "timestamptz"`;

describe('client connection results', () => {
  it('assert :: raw results in the postgres shapes (default)', async () => {
    const client = Client.make<TestDb>({
      repository: {},
      connection: TestConnection
    });

    const [record] = await client.rawQuery(RESULTS_QUERY);

    deepEqual(record, {
      count: '1',
      timestamptz: new Date('2026-09-17T23:08:20.800Z')
    });
  });

  it('assert :: raw results in the data api shapes', async () => {
    const client = Client.make<TestDb>({
      repository: {},
      connection: {
        ...TestConnection,
        dataApiResults: true
      }
    });

    const [record] = await client.rawQuery(RESULTS_QUERY);

    deepEqual(record, {
      count: 1,
      timestamptz: '2026-09-17 23:08:20.800'
    });
  });
});
