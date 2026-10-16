import { makeSchemaClient, prepareSchemaTable } from './common/schema';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { assertType } from '@ez4/utils';
import { Order } from '@ez4/database';

describe('client aggregate', async () => {
  const client = await makeSchemaClient();

  beforeEach(async () => {
    await prepareSchemaTable(client);

    // Rows without a value leave the column null: counts of a column and sums skip them.
    await client.ez4_test_table.insertMany({
      data: [
        {
          id: randomUUID(),
          string: 'a',
          boolean: true,
          integer: 1,
          decimal: 0.5,
          datetime: '2024-01-01T10:00:00.000Z',
          date: '2024-01-01'
        },
        {
          id: randomUUID(),
          string: 'a',
          boolean: false,
          integer: 2,
          decimal: 1.25,
          datetime: '2024-01-03T10:00:00.000Z',
          date: '2024-01-03'
        },
        {
          id: randomUUID(),
          string: 'a',
          boolean: true,
          integer: 3,
          datetime: '2024-01-02T10:00:00.000Z',
          date: '2024-01-02'
        },
        {
          id: randomUUID(),
          string: 'b',
          boolean: true,
          integer: 10,
          decimal: 2.5,
          datetime: '2024-02-01T10:00:00.000Z',
          date: '2024-02-01'
        },
        {
          id: randomUUID(),
          string: 'b',
          boolean: true,
          decimal: 0.25,
          datetime: '2024-02-05T10:00:00.000Z',
          date: '2024-02-05'
        },
        {
          id: randomUUID(),
          string: null,
          boolean: false,
          integer: 20
        }
      ]
    });
  });

  it('assert :: aggregate without group', async () => {
    const rows = await client.ez4_test_table.aggregate({
      select: {
        total: { count: true },
        with_integer: { count: 'integer' },
        strings: { count: 'string', distinct: true },
        integer_sum: { sum: 'integer' },
        decimal_sum: { sum: 'decimal' },
        integer_min: { min: 'integer' },
        integer_max: { max: 'integer' }
      }
    });

    assertType<
      {
        total: number;
        with_integer: number;
        strings: number;
        integer_sum: number | null;
        decimal_sum: number | null;
        integer_min: number | null;
        integer_max: number | null;
      }[],
      typeof rows
    >(true);

    deepEqual(rows, [
      {
        total: 6,
        with_integer: 5,
        strings: 2,
        integer_sum: 36,
        decimal_sum: 4.5,
        integer_min: 1,
        integer_max: 20
      }
    ]);
  });

  it('assert :: aggregate with where', async () => {
    const rows = await client.ez4_test_table.aggregate({
      where: {
        boolean: true
      },
      select: {
        total: { count: true },
        integer_sum: { sum: 'integer' }
      }
    });

    deepEqual(rows, [{ total: 4, integer_sum: 14 }]);
  });

  it('assert :: aggregate by one column', async () => {
    const rows = await client.ez4_test_table.aggregate({
      by: ['string'],
      select: {
        total: { count: true },
        with_decimal: { count: 'decimal' },
        integer_sum: { sum: 'integer' },
        decimal_sum: { sum: 'decimal' },
        integer_min: { min: 'integer' },
        integer_max: { max: 'integer' }
      },
      order: {
        string: Order.Asc
      }
    });

    assertType<
      {
        string: string | null;
        total: number;
        with_decimal: number;
        integer_sum: number | null;
        decimal_sum: number | null;
        integer_min: number | null;
        integer_max: number | null;
      }[],
      typeof rows
    >(true);

    deepEqual(rows, [
      { string: 'a', total: 3, with_decimal: 2, integer_sum: 6, decimal_sum: 1.75, integer_min: 1, integer_max: 3 },
      { string: 'b', total: 2, with_decimal: 2, integer_sum: 10, decimal_sum: 2.75, integer_min: 10, integer_max: 10 },
      { string: null, total: 1, with_decimal: 0, integer_sum: 20, decimal_sum: null, integer_min: 20, integer_max: 20 }
    ]);
  });

  it('assert :: aggregate by two columns', async () => {
    const rows = await client.ez4_test_table.aggregate({
      by: ['string', 'boolean'],
      select: {
        total: { count: true },
        integer_sum: { sum: 'integer' }
      },
      order: {
        string: Order.Asc,
        boolean: Order.Asc
      }
    });

    assertType<{ string: string | null; boolean: boolean | null; total: number; integer_sum: number | null }[], typeof rows>(true);

    deepEqual(rows, [
      { string: 'a', boolean: false, total: 1, integer_sum: 2 },
      { string: 'a', boolean: true, total: 2, integer_sum: 4 },
      { string: 'b', boolean: true, total: 2, integer_sum: 10 },
      { string: null, boolean: false, total: 1, integer_sum: 20 }
    ]);
  });

  it('assert :: aggregate by columns only', async () => {
    const rows = await client.ez4_test_table.aggregate({
      by: ['boolean'],
      select: {},
      order: {
        boolean: Order.Desc
      }
    });

    deepEqual(rows, [{ boolean: true }, { boolean: false }]);
  });

  it('assert :: aggregate with filter', async () => {
    const rows = await client.ez4_test_table.aggregate({
      by: ['string'],
      select: {
        total: { count: true },
        live: { count: true, where: { boolean: true } },
        live_integers: { count: 'integer', distinct: true, where: { boolean: true } },
        idle_sum: { sum: 'integer', where: { boolean: false } },
        live_max: { max: 'datetime', where: { boolean: true, integer: { gte: 2 } } }
      },
      order: {
        string: Order.Asc
      }
    });

    deepEqual(rows, [
      { string: 'a', total: 3, live: 2, live_integers: 2, idle_sum: 2, live_max: '2024-01-02T10:00:00.000Z' },
      { string: 'b', total: 2, live: 2, live_integers: 1, idle_sum: null, live_max: '2024-02-01T10:00:00.000Z' },
      { string: null, total: 1, live: 0, live_integers: 0, idle_sum: 20, live_max: null }
    ]);
  });

  it('assert :: aggregate order by alias with take', async () => {
    const first = await client.ez4_test_table.aggregate({
      by: ['string'],
      select: {
        total: { count: true }
      },
      order: {
        total: Order.Desc
      },
      take: 2
    });

    deepEqual(first, [
      { string: 'a', total: 3 },
      { string: 'b', total: 2 }
    ]);

    const next = await client.ez4_test_table.aggregate({
      by: ['string'],
      select: {
        total: { count: true }
      },
      order: {
        total: Order.Desc
      },
      skip: 2,
      take: 2
    });

    deepEqual(next, [{ string: null, total: 1 }]);
  });

  it('assert :: aggregate date and time formats', async () => {
    const rows = await client.ez4_test_table.aggregate({
      select: {
        first_datetime: { min: 'datetime' },
        last_datetime: { max: 'datetime' },
        first_date: { min: 'date' },
        last_date: { max: 'date' }
      }
    });

    assertType<
      { first_datetime: string | null; last_datetime: string | null; first_date: string | null; last_date: string | null }[],
      typeof rows
    >(true);

    deepEqual(rows, [
      {
        first_datetime: '2024-01-01T10:00:00.000Z',
        last_datetime: '2024-02-05T10:00:00.000Z',
        first_date: '2024-01-01',
        last_date: '2024-02-05'
      }
    ]);
  });

  it('assert :: aggregate by date-time column', async () => {
    const rows = await client.ez4_test_table.aggregate({
      by: ['datetime'],
      where: {
        string: 'b'
      },
      select: {
        total: { count: true }
      },
      order: {
        datetime: Order.Desc
      }
    });

    assertType<{ datetime: string | null; total: number }[], typeof rows>(true);

    deepEqual(rows, [
      { datetime: '2024-02-05T10:00:00.000Z', total: 1 },
      { datetime: '2024-02-01T10:00:00.000Z', total: 1 }
    ]);
  });

  it('assert :: aggregate empty table', async () => {
    await client.ez4_test_table.deleteMany({});

    const ungrouped = await client.ez4_test_table.aggregate({
      select: {
        total: { count: true },
        with_integer: { count: 'integer' },
        integer_sum: { sum: 'integer' },
        integer_max: { max: 'integer' },
        last_datetime: { max: 'datetime' }
      }
    });

    deepEqual(ungrouped, [{ total: 0, with_integer: 0, integer_sum: null, integer_max: null, last_datetime: null }]);

    const grouped = await client.ez4_test_table.aggregate({
      by: ['string'],
      select: {
        total: { count: true }
      }
    });

    deepEqual(grouped, []);
  });

  it('assert :: aggregate through the data api', async () => {
    const dataApiClient = await makeSchemaClient(false, true);

    const rows = await dataApiClient.ez4_test_table.aggregate({
      by: ['string'],
      select: {
        total: { count: true },
        integer_sum: { sum: 'integer' },
        decimal_sum: { sum: 'decimal' },
        integer_max: { max: 'integer' },
        live: { count: true, where: { boolean: true } },
        last_datetime: { max: 'datetime' }
      },
      order: {
        total: Order.Desc
      }
    });

    deepEqual(rows, [
      { string: 'a', total: 3, integer_sum: 6, decimal_sum: 1.75, integer_max: 3, live: 2, last_datetime: '2024-01-03T10:00:00.000Z' },
      { string: 'b', total: 2, integer_sum: 10, decimal_sum: 2.75, integer_max: 10, live: 2, last_datetime: '2024-02-05T10:00:00.000Z' },
      { string: null, total: 1, integer_sum: 20, decimal_sum: null, integer_max: 20, live: 0, last_datetime: null }
    ]);
  });

  it('assert :: aggregate alias equal to a group column', async () => {
    await rejects(
      client.ez4_test_table.aggregate({
        // @ts-expect-error A group column can't take the name of an alias.
        by: ['string'],
        select: {
          string: { count: true }
        }
      }),
      {
        message: `Aggregate alias 'string' is also a group column.`
      }
    );
  });
});
