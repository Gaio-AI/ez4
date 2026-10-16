import type { TestSchemaType } from './common/schema';

import { makeSchemaClient, prepareSchemaTable } from './common/schema';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

describe('client update and select the record as written', async () => {
  const client = await makeSchemaClient();

  const id = randomUUID();

  const initial = {
    boolean: false,
    integer: 122333,
    decimal: 10.5678,
    string: 'abc',
    datetime: '1991-04-23T23:59:30.000Z',
    date: '1991-04-23',
    time: '23:59:30.000Z',
    json: {
      boolean: true,
      string: 'abc',
      number: null,
      datetime: '2024-07-01T08:00:00.000Z'
    }
  };

  beforeEach(async () => {
    await prepareSchemaTable(client);

    await client.ez4_test_table.insertOne({
      data: {
        ...initial,
        id
      }
    });
  });

  const cases: [string, Partial<TestSchemaType>, Partial<TestSchemaType>][] = [
    ['boolean', { boolean: true }, { boolean: true }],
    ['integer', { integer: 444455555 }, { integer: 444455555 }],
    ['decimal', { decimal: 9.01234 }, { decimal: 9.01234 }],
    ['string', { string: 'def' }, { string: 'def' }],
    ['date-time', { datetime: '2024-07-01T08:00:00.000Z' }, { datetime: '2024-07-01T08:00:00.000Z' }],
    ['date', { date: '2024-07-01' }, { date: '2024-07-01' }],
    ['time', { time: '00:00:00' }, { time: '00:00:00.000Z' }],
    ['json (null)', { json: null }, { json: null }],
    [
      'json (partial)',
      { json: { string: 'def', number: 321 } },
      { json: { boolean: true, string: 'def', number: 321, datetime: '2024-07-01T08:00:00.000Z' } }
    ]
  ];

  for (const [name, data, expected] of cases) {
    const select = Object.fromEntries(Object.keys(expected).map((field) => [field, true]));

    it(`assert :: update one and select ${name}`, async () => {
      const record = await client.ez4_test_table.updateOne({
        select,
        data,
        where: {
          id
        }
      });

      deepEqual(record, expected);
    });

    it(`assert :: update many and select ${name}`, async () => {
      const records = await client.ez4_test_table.updateMany({
        select,
        data,
        where: {
          id
        }
      });

      deepEqual(records, [expected]);
    });

    it(`assert :: upsert one and select ${name}`, async () => {
      const result = await client.ez4_test_table.upsertOne({
        select,
        insert: {
          id
        },
        update: data,
        where: {
          id
        }
      });

      deepEqual(result, {
        inserted: false,
        record: expected
      });
    });
  }

  it('assert :: update one and select atomic operations', async () => {
    const record = await client.ez4_test_table.updateOne({
      select: {
        integer: true,
        decimal: true
      },
      data: {
        integer: {
          increment: 7
        },
        decimal: {
          multiply: 2
        }
      },
      where: {
        id
      }
    });

    deepEqual(record, {
      integer: 122340,
      decimal: 21.1356
    });
  });

  it('assert :: update one and select (no matching record)', async () => {
    const record = await client.ez4_test_table.updateOne({
      select: {
        string: true
      },
      data: {
        string: 'def'
      },
      where: {
        id: randomUUID()
      }
    });

    deepEqual(record, undefined);
  });
});
