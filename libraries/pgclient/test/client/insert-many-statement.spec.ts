import { makeUniqueClient, prepareUniqueTable } from './common/unique';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { DuplicateUniqueKeyError } from '@ez4/pgclient';
import { Order } from '@ez4/database';

const insertManyTests = (dataApi: boolean) => () => {
  const { client, driver } = makeUniqueClient(dataApi);

  const getInsertStatements = () => {
    return driver.statements.filter(({ query }) => query.startsWith('INSERT'));
  };

  const makeRecord = (index: number) => {
    return {
      id: randomUUID(),
      email: `user-${index}@test.com`,
      tenant: 'tenant',
      slug: `slug-${index}`,
      counter: index,
      status: 'active',
      created_at: '2024-07-01T08:00:00.000Z',
      json: {
        total: index,
        label: `label-${index}`
      }
    };
  };

  beforeEach(async () => {
    await prepareUniqueTable(client);

    driver.statements = [];
  });

  it('assert :: insert many rows in one statement', async () => {
    const data = Array.from({ length: 500 }, (_, index) => makeRecord(index));

    const result = await client.ez4_test_unique.insertMany({
      data
    });

    equal(result, undefined);

    equal(getInsertStatements().length, 1);

    const total = await client.ez4_test_unique.count({});

    equal(total, 500);

    const record = await client.ez4_test_unique.findOne({
      select: {
        email: true,
        counter: true,
        created_at: true,
        json: true
      },
      where: {
        id: data[432].id
      }
    });

    deepEqual(record, {
      email: 'user-432@test.com',
      counter: 432,
      created_at: '2024-07-01T08:00:00.000Z',
      json: {
        total: 432,
        label: 'label-432'
      }
    });
  });

  it('assert :: insert many rows with missing columns', async () => {
    await client.ez4_test_unique.insertMany({
      data: [
        { id: randomUUID(), email: 'a@test.com', counter: 1 },
        { id: randomUUID(), email: 'b@test.com', status: 'active' },
        { id: randomUUID(), email: 'c@test.com', json: null }
      ]
    });

    equal(getInsertStatements().length, 1);

    const { records } = await client.ez4_test_unique.findMany({
      select: {
        email: true,
        counter: true,
        status: true,
        json: true
      },
      order: {
        email: Order.Asc
      }
    });

    deepEqual(records, [
      { email: 'a@test.com', counter: 1, status: null, json: null },
      { email: 'b@test.com', counter: null, status: 'active', json: null },
      { email: 'c@test.com', counter: null, status: null, json: null }
    ]);
  });

  it('assert :: insert many rows over the statement length in chunks of one transaction', async () => {
    // Eight columns take about 60 characters of placeholders per row, so a thousand rows fill the 65,536
    // characters the Data API takes in one statement.
    const data = Array.from({ length: 5000 }, (_, index) => makeRecord(index));

    await client.ez4_test_unique.insertMany({
      data
    });

    const statements = getInsertStatements();

    equal(statements.length, 5);

    for (const { query, transactionId } of statements) {
      ok(query.length <= 65536);

      ok(transactionId);
      equal(transactionId, statements[0].transactionId);
    }

    const total = await client.ez4_test_unique.count({});

    equal(total, 5000);
  });

  it('assert :: insert many rows over the request size in chunks of one transaction', async () => {
    // Each row carries 100 KB, so the rows pass the 4 MiB of one Data API request.
    const data = Array.from({ length: 50 }, (_, index) => ({
      ...makeRecord(index),
      status: 'x'.repeat(100_000)
    }));

    await client.ez4_test_unique.insertMany({
      data
    });

    const statements = getInsertStatements();

    equal(statements.length, 2);

    for (const { variablesSize, transactionId } of statements) {
      ok(variablesSize <= 3 * 1024 * 1024);

      ok(transactionId);
      equal(transactionId, statements[0].transactionId);
    }

    const total = await client.ez4_test_unique.count({});

    equal(total, 50);
  });

  it('assert :: insert many rows failing in the last chunk leaves no row', async () => {
    const data = Array.from({ length: 5000 }, (_, index) => makeRecord(index));

    // The last row repeats the key of the first one.
    data[4999].id = data[0].id;

    await rejects(() => client.ez4_test_unique.insertMany({ data }), DuplicateUniqueKeyError);

    equal(getInsertStatements().length, 5);

    const total = await client.ez4_test_unique.count({});

    equal(total, 0);
  });

  it('assert :: insert many rows inside a transaction', async () => {
    const data = Array.from({ length: 10 }, (_, index) => makeRecord(index));

    await rejects(
      () =>
        client.transaction(async (transaction) => {
          await transaction.ez4_test_unique.insertMany({ data });

          throw new Error('Rollback');
        }),
      /Rollback/
    );

    const total = await client.ez4_test_unique.count({});

    equal(total, 0);
  });

  it('assert :: insert many rows with select', async () => {
    const data = [makeRecord(1), makeRecord(2)];

    const records = await client.ez4_test_unique.insertMany({
      select: {
        id: true,
        email: true,
        created_at: true,
        json: {
          label: true
        }
      },
      data
    });

    deepEqual(records, [
      {
        id: data[0].id,
        email: 'user-1@test.com',
        created_at: '2024-07-01T08:00:00.000Z',
        json: {
          label: 'label-1'
        }
      },
      {
        id: data[1].id,
        email: 'user-2@test.com',
        created_at: '2024-07-01T08:00:00.000Z',
        json: {
          label: 'label-2'
        }
      }
    ]);
  });

  it('assert :: insert many rows skipping duplicates', async () => {
    const existing = makeRecord(0);

    await client.ez4_test_unique.insertOne({
      data: existing
    });

    const fresh = [makeRecord(1), makeRecord(2)];

    const result = await client.ez4_test_unique.insertMany({
      skipDuplicates: true,
      data: [
        // Same primary key.
        { ...makeRecord(3), id: existing.id },
        fresh[0],
        // Same unique index.
        { ...makeRecord(4), email: existing.email },
        fresh[1],
        // Same composite unique index.
        { ...makeRecord(5), slug: existing.slug },
        // Repeated inside the same call.
        { ...makeRecord(6), email: fresh[0].email }
      ]
    });

    equal(result, undefined);

    const { records } = await client.ez4_test_unique.findMany({
      select: {
        id: true,
        email: true
      },
      order: {
        email: Order.Asc
      }
    });

    deepEqual(records, [
      { id: existing.id, email: existing.email },
      { id: fresh[0].id, email: fresh[0].email },
      { id: fresh[1].id, email: fresh[1].email }
    ]);
  });

  it('assert :: insert many rows skipping duplicates with select', async () => {
    const existing = makeRecord(0);

    await client.ez4_test_unique.insertOne({
      data: existing
    });

    const fresh = makeRecord(1);

    const records = await client.ez4_test_unique.insertMany({
      skipDuplicates: true,
      select: {
        id: true,
        email: true
      },
      data: [{ ...makeRecord(2), email: existing.email }, fresh, { ...makeRecord(3), id: existing.id }]
    });

    deepEqual(records, [{ id: fresh.id, email: fresh.email }]);
  });

  it('assert :: insert many rows skipping duplicates inside a transaction', async () => {
    const existing = makeRecord(0);

    await client.ez4_test_unique.insertOne({
      data: existing
    });

    const fresh = makeRecord(1);

    const records = await client.transaction(async (transaction) => {
      const inserted = await transaction.ez4_test_unique.insertMany({
        skipDuplicates: true,
        select: {
          id: true
        },
        data: [existing, fresh]
      });

      // The transaction is still usable after the skipped row.
      await transaction.ez4_test_unique.updateOne({
        data: {
          status: 'updated'
        },
        where: {
          id: existing.id
        }
      });

      return inserted;
    });

    deepEqual(records, [{ id: fresh.id }]);

    const record = await client.ez4_test_unique.findOne({
      select: {
        status: true
      },
      where: {
        id: existing.id
      }
    });

    deepEqual(record, { status: 'updated' });
  });

  it('assert :: insert many with no rows', async () => {
    const records = await client.ez4_test_unique.insertMany({
      select: {
        id: true
      },
      data: []
    });

    deepEqual(records, []);

    equal(getInsertStatements().length, 0);
  });
};

describe('client insert many (one statement)', insertManyTests(false));

describe('client insert many (one statement, data api)', insertManyTests(true));
