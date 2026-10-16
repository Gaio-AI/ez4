import { makeSchemaClient, prepareSchemaTable } from './common/schema';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// The records come back in primary key order, which the random ids make arbitrary. They are sorted by a key that
// ignores the order of object keys, which jsonb does not keep.
const deepEqualUnordered = (actual: unknown[] | void, expected: unknown[]) => {
  const getSortKey = (value: unknown): string => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));

      return `{${entries.map(([key, entry]) => `${key}:${getSortKey(entry)}`).join(',')}}`;
    }

    return JSON.stringify(value);
  };

  const sort = (records: unknown[]) => [...records].sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)));

  deepEqual(sort(actual ?? []), sort(expected));
};

describe('client update many', async () => {
  const client = await makeSchemaClient();

  beforeEach(async () => {
    await prepareSchemaTable(client);

    await client.ez4_test_table.insertMany({
      data: [
        {
          id: randomUUID(),
          boolean: true,
          integer: 1,
          decimal: 0.1,
          string: 'abc',
          datetime: '1991-04-23T23:59:30.000Z',
          date: '1991-04-23',
          time: '23:59:30.000Z',
          json: {
            boolean: true,
            string: 'abc'
          }
        },
        {
          id: randomUUID(),
          boolean: false,
          integer: 22,
          decimal: 1.22,
          string: 'def',
          datetime: '2011-11-02T13:30:00.000Z',
          date: '2011-11-02',
          time: '13:30:00.000Z',
          json: {
            boolean: false,
            string: 'def',
            number: 123
          }
        },
        {
          id: randomUUID(),
          boolean: true,
          integer: 333,
          decimal: 2.333,
          string: 'ghi',
          datetime: '2024-07-01T08:00:00.000Z',
          date: '2024-07-01',
          time: '08:00:00.000Z',
          json: {
            boolean: true,
            string: 'ghi',
            datetime: '2013-02-16T20:00:00.000Z'
          }
        }
      ]
    });
  });

  it('assert :: update many (without select)', async () => {
    const data = {
      boolean: true
    };

    const previous = await client.ez4_test_table.updateMany({
      data
    });

    deepEqual(previous, undefined);

    const { records } = await client.ez4_test_table.findMany({
      count: true,
      select: {
        boolean: true
      }
    });

    deepEqual(records, [data, data, data]);
  });

  it('assert :: update many and select boolean', async () => {
    const data = {
      boolean: true
    };

    const previous = await client.ez4_test_table.updateMany({
      previous: true,
      data,
      select: {
        boolean: true
      }
    });

    deepEqualUnordered(previous, [{ boolean: true }, { boolean: false }, { boolean: true }]);

    const { records, total } = await client.ez4_test_table.findMany({
      count: true,
      select: {
        boolean: true
      }
    });

    deepEqual(records, [data, data, data]);

    equal(total, 3);
  });

  it('assert :: update many and select integer', async () => {
    const data = {
      integer: 123
    };

    const previous = await client.ez4_test_table.updateMany({
      previous: true,
      data,
      select: {
        integer: true
      }
    });

    deepEqualUnordered(previous, [{ integer: 1 }, { integer: 22 }, { integer: 333 }]);

    const { records, total } = await client.ez4_test_table.findMany({
      count: true,
      select: {
        integer: true
      }
    });

    deepEqual(records, [data, data, data]);

    equal(total, 3);
  });

  it('assert :: update many and select decimal', async () => {
    const data = {
      decimal: 1.23
    };

    const previous = await client.ez4_test_table.updateMany({
      previous: true,
      data,
      select: {
        decimal: true
      }
    });

    deepEqualUnordered(previous, [{ decimal: 0.1 }, { decimal: 1.22 }, { decimal: 2.333 }]);

    const { records, total } = await client.ez4_test_table.findMany({
      count: true,
      select: {
        decimal: true
      }
    });

    deepEqual(records, [data, data, data]);

    equal(total, 3);
  });

  it('assert :: update many and select string', async () => {
    const data = {
      string: 'foo'
    };

    const previous = await client.ez4_test_table.updateMany({
      previous: true,
      data,
      select: {
        string: true
      }
    });

    deepEqualUnordered(previous, [{ string: 'abc' }, { string: 'def' }, { string: 'ghi' }]);

    const { records, total } = await client.ez4_test_table.findMany({
      count: true,
      select: {
        string: true
      }
    });

    deepEqual(records, [data, data, data]);

    equal(total, 3);
  });

  it('assert :: update many and select date-time', async () => {
    const data = {
      datetime: '2025-01-01T23:59:30.000Z'
    };

    const previous = await client.ez4_test_table.updateMany({
      previous: true,
      data,
      select: {
        datetime: true
      }
    });

    deepEqualUnordered(previous, [
      { datetime: '1991-04-23T23:59:30.000Z' },
      { datetime: '2011-11-02T13:30:00.000Z' },
      { datetime: '2024-07-01T08:00:00.000Z' }
    ]);

    const { records, total } = await client.ez4_test_table.findMany({
      count: true,
      select: {
        datetime: true
      }
    });

    deepEqual(records, [data, data, data]);

    equal(total, 3);
  });

  it('assert :: update many and select date', async () => {
    const data = {
      date: '2025-01-01'
    };

    const previous = await client.ez4_test_table.updateMany({
      previous: true,
      data,
      select: {
        date: true
      }
    });

    deepEqualUnordered(previous, [{ date: '1991-04-23' }, { date: '2011-11-02' }, { date: '2024-07-01' }]);

    const { records, total } = await client.ez4_test_table.findMany({
      count: true,
      select: {
        date: true
      }
    });

    deepEqual(records, [data, data, data]);

    equal(total, 3);
  });

  it('assert :: update many and select time', async () => {
    const data = {
      time: '23:59:30.000Z'
    };

    const previous = await client.ez4_test_table.updateMany({
      previous: true,
      data,
      select: {
        time: true
      }
    });

    deepEqualUnordered(previous, [{ time: '23:59:30.000Z' }, { time: '13:30:00.000Z' }, { time: '08:00:00.000Z' }]);

    const { records, total } = await client.ez4_test_table.findMany({
      count: true,
      select: {
        time: true
      }
    });

    deepEqual(records, [data, data, data]);

    equal(total, 3);
  });

  it('assert :: update many and select json', async () => {
    const input = {
      json: {
        boolean: true,
        string: 'foo'
      }
    };

    const previous = await client.ez4_test_table.updateMany({
      previous: true,
      data: input,
      select: {
        json: {
          boolean: true,
          string: true
        }
      }
    });

    deepEqualUnordered(previous, [
      {
        json: {
          boolean: true,
          string: 'abc'
        }
      },
      {
        json: {
          boolean: false,
          string: 'def'
        }
      },
      {
        json: {
          boolean: true,
          string: 'ghi'
        }
      }
    ]);

    const { records, total } = await client.ez4_test_table.findMany({
      count: true,
      select: {
        json: true
      }
    });

    deepEqualUnordered(records, [
      {
        json: {
          ...input.json
        }
      },
      {
        json: {
          ...input.json,
          number: 123
        }
      },
      {
        json: {
          ...input.json,
          datetime: '2013-02-16T20:00:00.000Z'
        }
      }
    ]);

    equal(total, 3);
  });
});
