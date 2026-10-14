import type { PgStatementMetadata } from '@ez4/pgclient';

import { after, describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { ClientDriver, createPool } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';

import { TestConnection } from './common/data-api';

describe('client data api results', () => {
  const pool = createPool(TestConnection);

  const driver = new ClientDriver(pool, { dataApiResults: true });

  after(async () => {
    await pool.end();
  });

  it('assert :: raw values in the data api shapes', async () => {
    const { records } = await driver.executeStatement({
      query:
        `SELECT ` +
        `(SELECT count(*) FROM generate_series(1, 3)) AS "count", ` +
        `123::int8 AS "int8", ` +
        `1.5::numeric AS "numeric", ` +
        `'{1,2}'::int8[] AS "int8_array", ` +
        `'2026-09-17 20:08:20.8-03'::timestamptz AS "timestamptz", ` +
        `'2026-09-17 17:08:20.855153'::timestamp AS "timestamp", ` +
        `'2026-09-17'::date AS "date", ` +
        `'{"a":1}'::jsonb AS "jsonb"`
    });

    deepEqual(records, [
      {
        count: 3,
        int8: 123,
        numeric: 1.5,
        int8_array: [1, 2],
        timestamptz: '2026-09-17 23:08:20.800',
        timestamp: '2026-09-17 17:08:20.855153',
        date: '2026-09-17',
        jsonb: { a: 1 }
      }
    ]);
  });

  it('assert :: array variables with the data api shapes', async () => {
    const ids = [randomUUID(), randomUUID()];

    const { records } = await driver.executeStatement({
      query: `SELECT cardinality(:0) AS "total", :1 = ANY(:2::uuid[]) AS "found"`,
      variables: [
        driver.prepareArrayVariable('0', ids, { type: SchemaType.String, format: 'uuid' }),
        driver.prepareVariable('1', ids[1]),
        driver.prepareVariable('2', ids)
      ]
    });

    deepEqual(records, [{ total: 2, found: true }]);
  });

  it('assert :: json scalar with metadata parsed once', async () => {
    const metadata: PgStatementMetadata = {
      table: 'table',
      columns: ['union'],
      relations: {},
      schema: {
        type: SchemaType.Object,
        properties: {
          union: {
            type: SchemaType.Union,
            elements: [{ type: SchemaType.String }, { type: SchemaType.Number }]
          }
        }
      }
    };

    const { records } = await driver.executeStatement({
      query: `SELECT '"123"'::jsonb AS "union"`,
      metadata
    });

    deepEqual(records, [{ union: '123' }]);
  });

  it('assert :: no data api statement timeout', async () => {
    const { records } = await driver.executeStatement({
      query: `SELECT current_setting('statement_timeout') AS "timeout"`
    });

    equal(records[0]?.timeout, '0');
  });
});
