import type { PgStatementMetadata } from '@ez4/pgclient';

import { after, describe, it } from 'node:test';
import { deepEqual, rejects } from 'node:assert/strict';

import { ClientDriver, createPool } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';

import { makeDataApiClient, TestConnection } from './common/data-api';

describe('client data api values', () => {
  const client = makeDataApiClient();

  const pool = createPool(TestConnection);

  after(async () => {
    await pool.end();
  });

  it('assert :: integer and decimal values', async () => {
    const result = await client.rawQuery(
      `SELECT ` +
        `123::int8 AS "int8", ` +
        `7::int4 AS "int4", ` +
        `3::int2 AS "int2", ` +
        `1.5::numeric AS "numeric", ` +
        `10::numeric AS "integral_numeric", ` +
        `(SELECT avg(3)) AS "average", ` +
        `2.25::float8 AS "float8", ` +
        `2.25::float4 AS "float4", ` +
        `(SELECT count(*) FROM generate_series(1, 3)) AS "count", ` +
        `(SELECT sum("value") FROM generate_series(1, 3) AS "value") AS "sum", ` +
        `9007199254740993::int8 AS "unsafe_int8"`
    );

    deepEqual(result, [
      {
        int8: 123,
        int4: 7,
        int2: 3,
        numeric: 1.5,
        integral_numeric: 10,
        average: 3,
        float8: 2.25,
        float4: 2.25,
        count: 3,
        sum: 6,
        unsafe_int8: 9007199254740992
      }
    ]);
  });

  it('assert :: boolean, string and json values', async () => {
    const result = await client.rawQuery(
      `SELECT ` +
        `true AS "boolean", ` +
        `'x'::text AS "text", ` +
        `'8c3f7f3a-2f5d-4c2e-9a39-3f1bb2c7e0a1'::uuid AS "uuid", ` +
        `'a'::char(3) AS "bpchar", ` +
        `'{"a":1}'::jsonb AS "jsonb", ` +
        `'[1,2]'::json AS "json", ` +
        `NULL AS "null"`
    );

    deepEqual(result, [
      {
        boolean: true,
        text: 'x',
        uuid: '8c3f7f3a-2f5d-4c2e-9a39-3f1bb2c7e0a1',
        bpchar: 'a  ',
        jsonb: { a: 1 },
        json: [1, 2],
        null: null
      }
    ]);
  });

  it('assert :: timestamp with time zone values', async () => {
    const result = await client.rawQuery(
      `SELECT ` +
        `'2026-09-17 17:08:20.855153+00'::timestamptz AS "micros", ` +
        `'2026-09-17 17:08:20.8+00'::timestamptz AS "tenths", ` +
        `'2026-09-17 17:08:20.85+00'::timestamptz AS "hundredths", ` +
        `'2026-09-17 17:08:20.8551+00'::timestamptz AS "ten_thousandths", ` +
        `'2026-09-17 17:08:20.000001+00'::timestamptz AS "one_micro", ` +
        `'2026-09-17 17:08:20+00'::timestamptz AS "seconds", ` +
        `'2026-09-17 17:08:00+00'::timestamptz AS "minutes", ` +
        `'2026-09-17 00:00:00+00'::timestamptz AS "midnight", ` +
        `'2026-09-17 20:08:20-03'::timestamptz AS "offset", ` +
        `'0999-01-01 00:00:00+00'::timestamptz AS "old"`
    );

    deepEqual(result, [
      {
        micros: '2026-09-17 17:08:20.855153',
        tenths: '2026-09-17 17:08:20.800',
        hundredths: '2026-09-17 17:08:20.850',
        ten_thousandths: '2026-09-17 17:08:20.855100',
        one_micro: '2026-09-17 17:08:20.000001',
        seconds: '2026-09-17 17:08:20',
        minutes: '2026-09-17 17:08:00',
        midnight: '2026-09-17 00:00:00',
        offset: '2026-09-17 23:08:20',
        old: '0999-01-01 00:00:00'
      }
    ]);
  });

  it('assert :: timestamp with time zone values (session time zone)', async () => {
    const result = await client.transaction(async (transaction) => {
      await transaction.rawQuery(`SET LOCAL TIME ZONE 'America/Sao_Paulo'`);

      return transaction.rawQuery(
        `SELECT '2026-09-17 17:08:20.8+00'::timestamptz AS "recent", '0999-01-01 00:00:00+00'::timestamptz AS "old"`
      );
    });

    deepEqual(result, [
      {
        recent: '2026-09-17 17:08:20.800',
        old: '0999-01-01 00:00:00'
      }
    ]);
  });

  it('assert :: timestamp, date and time values', async () => {
    const result = await client.rawQuery(
      `SELECT ` +
        `'2026-09-17 17:08:20.855153'::timestamp AS "timestamp", ` +
        `'2026-09-17 17:08:20.5'::timestamp AS "timestamp_millis", ` +
        `'2026-09-17 17:08:20'::timestamp AS "timestamp_seconds", ` +
        `'2026-09-17'::date AS "date", ` +
        `'17:08:20.5'::time AS "time", ` +
        `'17:08:20'::time AS "time_seconds", ` +
        `'17:08:00'::time AS "time_minutes"`
    );

    deepEqual(result, [
      {
        timestamp: '2026-09-17 17:08:20.855153',
        timestamp_millis: '2026-09-17 17:08:20.500',
        timestamp_seconds: '2026-09-17 17:08:20',
        date: '2026-09-17',
        time: '17:08:20.500',
        time_seconds: '17:08:20',
        time_minutes: '17:08:00'
      }
    ]);
  });

  it('assert :: array values', async () => {
    const result = await client.rawQuery(
      `SELECT ` +
        `'{1,2}'::int8[] AS "int8", ` +
        `'{{1,2},{3,NULL}}'::int8[] AS "matrix", ` +
        `'[0:1]={1,2}'::int8[] AS "bounded", ` +
        `'{1.5}'::numeric[] AS "numeric", ` +
        `'{t,f}'::bool[] AS "boolean", ` +
        `'{a,"b c",NULL,"NULL","","d\\"e","f,g"}'::text[] AS "text", ` +
        `ARRAY['8c3f7f3a-2f5d-4c2e-9a39-3f1bb2c7e0a1'::uuid] AS "uuid", ` +
        `ARRAY['2026-09-17 17:08:20+00'::timestamptz, '2026-09-17 17:08:20.5+00'::timestamptz] AS "timestamptz", ` +
        `ARRAY['2026-09-17'::date] AS "date", ` +
        `ARRAY['17:08:20.5'::time] AS "time", ` +
        `'{}'::int8[] AS "empty"`
    );

    deepEqual(result, [
      {
        int8: [1, 2],
        matrix: [
          [1, 2],
          [3, null]
        ],
        bounded: [1, 2],
        numeric: [1.5],
        boolean: [true, false],
        text: ['a', 'b c', null, 'NULL', '', 'd"e', 'f,g'],
        uuid: ['8c3f7f3a-2f5d-4c2e-9a39-3f1bb2c7e0a1'],
        timestamptz: ['2026-09-17 17:08:20', '2026-09-17 17:08:20.500'],
        date: ['2026-09-17'],
        time: ['17:08:20.500'],
        empty: []
      }
    ]);
  });

  it('assert :: multiple statements', async () => {
    const query = 'SELECT 1 AS "first"; SELECT 2 AS "second"';

    const expected = await makeDataApiClient(false).rawQuery(query);
    const result = await client.rawQuery(query);

    deepEqual(result, expected);
  });

  it('assert :: infinite timestamp with time zone value', async () => {
    await rejects(client.rawQuery(`SELECT 'infinity'::timestamptz AS "value"`), { name: 'InternalFailure' });
  });

  it('assert :: json values with metadata', async () => {
    const driver = new ClientDriver(pool, { dataApi: true });

    const metadata: PgStatementMetadata = {
      table: 'table',
      columns: ['union', 'object'],
      relations: {},
      schema: {
        type: SchemaType.Object,
        properties: {
          union: {
            type: SchemaType.Union,
            elements: [{ type: SchemaType.String }, { type: SchemaType.Number }]
          },
          object: {
            type: SchemaType.Object,
            properties: {}
          }
        }
      }
    };

    const { records } = await driver.executeStatement({
      query: `SELECT '"foo"'::jsonb AS "union", '{"a":1}'::jsonb AS "object"`,
      metadata
    });

    deepEqual(records, [{ union: 'foo', object: { a: 1 } }]);
  });
});
