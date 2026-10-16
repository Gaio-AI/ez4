import { makeSchemaClient, prepareSchemaTable } from './common/schema';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

describe('client concurrently update with select', async () => {
  const client = await makeSchemaClient();

  beforeEach(async () => {
    await prepareSchemaTable(client);
  });

  it('assert :: update many with select (concurrent claims, one winner)', async () => {
    const id = randomUUID();

    await client.ez4_test_table.insertOne({
      data: {
        id,
        string: 'pending'
      }
    });

    for (let round = 0; round < 20; round++) {
      await client.ez4_test_table.updateOne({
        data: {
          string: 'pending'
        },
        where: {
          id
        }
      });

      const claims = await Promise.all(
        ['a', 'b', 'c'].map((owner) => {
          return client.ez4_test_table.updateMany({
            select: {
              id: true
            },
            data: {
              string: owner
            },
            where: {
              id,
              string: 'pending'
            }
          });
        })
      );

      equal(claims.filter((records) => records.length > 0).length, 1);
    }
  });

  it('assert :: update one with select (concurrent writers, each sees what it wrote)', async () => {
    const id = randomUUID();

    await client.ez4_test_table.insertOne({
      data: {
        id,
        integer: 0
      }
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => {
        return client.ez4_test_table.updateOne({
          select: {
            integer: true
          },
          data: {
            integer: {
              increment: 1
            }
          },
          where: {
            id
          }
        });
      })
    );

    deepEqual(
      results.map((record) => record?.integer).sort((a, b) => a! - b!),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    );
  });

  it('assert :: update one with previous select (concurrent writers, each sees what it overwrote)', async () => {
    const writers = ['v1', 'v2', 'v3', 'v4'];

    for (let round = 0; round < 10; round++) {
      const id = randomUUID();

      await client.ez4_test_table.insertOne({
        data: {
          id,
          string: 'v0'
        }
      });

      const previous = await Promise.all(
        writers.map((value) => {
          return client.ez4_test_table.updateOne({
            select: {
              string: true
            },
            previous: true,
            data: {
              string: value
            },
            where: {
              id
            }
          });
        })
      );

      const current = await client.ez4_test_table.findOne({
        select: {
          string: true
        },
        where: {
          id
        }
      });

      const history = [...previous.map((record) => record?.string), current?.string].sort();

      deepEqual(history, ['v0', ...writers]);
    }
  });

  it('assert :: update many with select (only the matching rows change)', async () => {
    const ids = Array.from({ length: 300 }, () => randomUUID());

    await client.ez4_test_table.insertMany({
      data: ids.map((id, index) => ({
        id,
        integer: index,
        string: index % 2 ? 'odd' : 'even'
      }))
    });

    const updated = await client.ez4_test_table.updateMany({
      select: {
        id: true,
        integer: true
      },
      data: {
        string: 'changed'
      },
      where: {
        string: 'odd'
      }
    });

    equal(updated.length, 150);
    equal(
      updated.every(({ integer }) => integer! % 2 === 1),
      true
    );

    const changed = await client.ez4_test_table.count({
      where: {
        string: 'changed'
      }
    });

    const untouched = await client.ez4_test_table.count({
      where: {
        string: 'even'
      }
    });

    equal(changed, 150);
    equal(untouched, 150);
  });

  it('assert :: update many with previous select (concurrent claims, one winner)', async () => {
    const id = randomUUID();

    await client.ez4_test_table.insertOne({
      data: {
        id,
        string: 'pending'
      }
    });

    for (let round = 0; round < 20; round++) {
      await client.ez4_test_table.updateOne({
        data: {
          string: 'pending'
        },
        where: {
          id
        }
      });

      const claims = await Promise.all(
        ['a', 'b', 'c'].map((owner) => {
          return client.ez4_test_table.updateMany({
            select: {
              string: true
            },
            previous: true,
            data: {
              string: owner
            },
            where: {
              id,
              string: 'pending'
            }
          });
        })
      );

      deepEqual(
        claims.filter((records) => records.length > 0),
        [[{ string: 'pending' }]]
      );
    }
  });
});
