import type { Client as DbClient } from '@ez4/database';
import type { TestRelationDb } from './common/relation';
import type { TestUniqueDb } from './common/unique';

import { makeRecordingClient, makeUniqueClient, prepareUniqueTable } from './common/unique';
import { prepareRelationTables, TestRelationRepository } from './common/relation';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { DuplicateUniqueKeyError } from '@ez4/pgclient';

const getFailures = (results: PromiseSettledResult<unknown>[]) => {
  return results.filter((result) => result.status === 'rejected').map((result) => `${result.reason}`);
};

// Resolves once every caller has arrived, so callers that each began a transaction first still race in the same instant.
const makeBarrier = (size: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();

  let arrived = 0;

  return () => {
    if (++arrived === size) {
      resolve();
    }

    return promise;
  };
};

const upsertOneTests = (dataApi: boolean) => () => {
  const { client, driver } = makeUniqueClient(dataApi);

  const upsertCounter = (email: string, status = 'new') => {
    return client.ez4_test_unique.upsertOne({
      select: {
        email: true,
        counter: true,
        status: true,
        created_at: true
      },
      insert: {
        id: randomUUID(),
        email,
        counter: 1,
        status,
        created_at: '2024-07-01T08:00:00.000Z'
      },
      update: {
        counter: {
          increment: 1
        },
        status: 'seen'
      },
      where: {
        email
      }
    });
  };

  const findByEmail = (email: string) => {
    return client.ez4_test_unique.findOne({
      select: {
        counter: true,
        status: true,
        json: true
      },
      where: {
        email
      }
    });
  };

  // Keyed by email, while the record it inserts also fills the other unique index (tenant, slug).
  const upsertWithSlug = (db: DbClient<TestUniqueDb>, email: string, slug = email) => {
    return db.ez4_test_unique.upsertOne({
      insert: {
        id: randomUUID(),
        email,
        tenant: 'foo',
        slug,
        counter: 1
      },
      update: {
        counter: {
          increment: 1
        }
      },
      where: {
        email
      }
    });
  };

  beforeEach(async () => {
    await prepareUniqueTable(client);

    driver.statements = [];
  });

  it('assert :: upsert one inserts and then updates in one statement each', async () => {
    const inserted = await upsertCounter('foo@test.com');

    deepEqual(inserted, {
      inserted: true,
      record: {
        email: 'foo@test.com',
        counter: 1,
        status: 'new',
        created_at: '2024-07-01T08:00:00.000Z'
      }
    });

    equal(driver.statements.length, 1);

    const updated = await upsertCounter('foo@test.com');

    deepEqual(updated, {
      inserted: false,
      record: {
        email: 'foo@test.com',
        counter: 2,
        status: 'seen',
        created_at: '2024-07-01T08:00:00.000Z'
      }
    });

    equal(driver.statements.length, 2);
  });

  it('assert :: upsert one without select', async () => {
    const first = await client.ez4_test_unique.upsertOne({
      insert: {
        id: randomUUID(),
        email: 'foo@test.com',
        counter: 1
      },
      update: {
        counter: 5
      },
      where: {
        email: 'foo@test.com'
      }
    });

    deepEqual(first, { inserted: true });

    const second = await client.ez4_test_unique.upsertOne({
      insert: {
        id: randomUUID(),
        email: 'foo@test.com',
        counter: 1
      },
      update: {
        counter: 5
      },
      where: {
        email: 'foo@test.com'
      }
    });

    deepEqual(second, { inserted: false });

    deepEqual(await findByEmail('foo@test.com'), {
      counter: 5,
      status: null,
      json: null
    });
  });

  it('assert :: upsert one with json update', async () => {
    const upsert = () => {
      return client.ez4_test_unique.upsertOne({
        select: {
          json: true
        },
        insert: {
          id: randomUUID(),
          email: 'foo@test.com',
          json: {
            total: 1,
            label: 'first'
          }
        },
        update: {
          json: {
            label: 'second'
          }
        },
        where: {
          email: 'foo@test.com'
        }
      });
    };

    deepEqual(await upsert(), {
      inserted: true,
      record: {
        json: {
          total: 1,
          label: 'first'
        }
      }
    });

    deepEqual(await upsert(), {
      inserted: false,
      record: {
        json: {
          total: 1,
          label: 'second'
        }
      }
    });
  });

  it('assert :: upsert one twice inside one transaction', async () => {
    const results = await client.transaction(async (transaction) => {
      const upsert = () => {
        return transaction.ez4_test_unique.upsertOne({
          select: {
            counter: true
          },
          insert: {
            id: randomUUID(),
            email: 'foo@test.com',
            counter: 1
          },
          update: {
            counter: {
              increment: 1
            }
          },
          where: {
            email: 'foo@test.com'
          }
        });
      };

      return [await upsert(), await upsert(), await upsert()];
    });

    deepEqual(results, [
      { inserted: true, record: { counter: 1 } },
      { inserted: false, record: { counter: 2 } },
      { inserted: false, record: { counter: 3 } }
    ]);
  });

  it('assert :: upsert one concurrently inside transactions', async () => {
    for (let round = 0; round < 30; round++) {
      const email = `key-${round}@test.com`;

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => {
          return client.transaction(async (transaction) => {
            return transaction.ez4_test_unique.upsertOne({
              insert: {
                id: randomUUID(),
                email,
                counter: 1
              },
              update: {
                counter: {
                  increment: 1
                }
              },
              where: {
                email
              }
            });
          });
        })
      );

      deepEqual(getFailures(results), []);

      const inserted = results.filter((result) => result.status === 'fulfilled' && result.value.inserted);

      equal(inserted.length, 1);

      deepEqual(await findByEmail(email), {
        counter: 4,
        status: null,
        json: null
      });
    }
  });

  it('assert :: upsert one concurrently colliding on another unique index', async () => {
    for (let round = 0; round < 50; round++) {
      const email = `key-${round}@test.com`;

      const results = await Promise.allSettled(Array.from({ length: 4 }, () => upsertWithSlug(client, email)));

      deepEqual(getFailures(results), []);

      const inserted = results.filter((result) => result.status === 'fulfilled' && result.value.inserted);

      equal(inserted.length, 1);

      deepEqual(await findByEmail(email), {
        counter: 4,
        status: null,
        json: null
      });
    }
  });

  it('assert :: upsert one concurrently colliding on another unique index inside transactions', async () => {
    for (let round = 0; round < 50; round++) {
      const email = `key-${round}@test.com`;

      const arrive = makeBarrier(4);

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => {
          return client.transaction(async (transaction) => {
            await arrive();

            const result = await upsertWithSlug(transaction, email);

            // The transaction goes on after the upsert, which an aborted transaction refuses.
            await transaction.ez4_test_unique.updateOne({
              data: {
                status: 'seen'
              },
              where: {
                email
              }
            });

            return result;
          });
        })
      );

      deepEqual(getFailures(results), []);

      const inserted = results.filter((result) => result.status === 'fulfilled' && result.value.inserted);

      equal(inserted.length, 1);

      deepEqual(await findByEmail(email), {
        counter: 4,
        status: 'seen',
        json: null
      });
    }
  });

  it('assert :: upsert one colliding with another record on another unique index', async () => {
    await upsertWithSlug(client, 'foo@test.com', 'shared');

    driver.statements = [];

    await rejects(() => upsertWithSlug(client, 'bar@test.com', 'shared'), DuplicateUniqueKeyError);

    // Tried once more only: the duplicate that persists is a different record.
    equal(driver.statements.length, 2);

    equal(await client.ez4_test_unique.count({}), 1);
  });

  it('assert :: upsert one colliding with another record inside a transaction', async () => {
    await upsertWithSlug(client, 'foo@test.com', 'shared');

    driver.statements = [];

    await client.transaction(async (transaction) => {
      await rejects(() => upsertWithSlug(transaction, 'bar@test.com', 'shared'), DuplicateUniqueKeyError);

      // The failed upsert is undone on its own, and the transaction goes on.
      await upsertWithSlug(transaction, 'baz@test.com', 'other');
    });

    deepEqual(
      driver.statements.map(({ query }) => (query.startsWith('INSERT') ? 'INSERT' : query)),
      [
        'SAVEPOINT "ez4_upsert"',
        'INSERT',
        'ROLLBACK TO SAVEPOINT "ez4_upsert"',
        'INSERT',
        'ROLLBACK TO SAVEPOINT "ez4_upsert"',
        'RELEASE SAVEPOINT "ez4_upsert"',
        'SAVEPOINT "ez4_upsert"',
        'INSERT',
        'RELEASE SAVEPOINT "ez4_upsert"'
      ]
    );

    deepEqual(await findByEmail('baz@test.com'), {
      counter: 1,
      status: null,
      json: null
    });

    equal(await client.ez4_test_unique.count({}), 2);
  });

  it('assert :: upsert one with atomic increment from concurrent callers', async () => {
    for (let round = 0; round < 10; round++) {
      const email = `key-${round}@test.com`;

      const results = await Promise.all(Array.from({ length: 4 }, () => upsertCounter(email)));

      deepEqual(results.map(({ record }) => record.counter).sort(), [1, 2, 3, 4]);

      deepEqual(await findByEmail(email), {
        counter: 4,
        status: 'seen',
        json: null
      });
    }
  });

  it('assert :: upsert one with empty update', async () => {
    const upsert = (counter: number) => {
      return client.ez4_test_unique.upsertOne({
        select: {
          email: true,
          counter: true
        },
        insert: {
          id: randomUUID(),
          email: 'foo@test.com',
          counter
        },
        update: {},
        where: {
          email: 'foo@test.com'
        }
      });
    };

    deepEqual(await upsert(1), {
      inserted: true,
      record: {
        email: 'foo@test.com',
        counter: 1
      }
    });

    deepEqual(await upsert(2), {
      inserted: false,
      record: {
        email: 'foo@test.com',
        counter: 1
      }
    });
  });

  it('assert :: upsert one with extra filters matching the existing record', async () => {
    await upsertCounter('foo@test.com', 'active');

    const result = await client.ez4_test_unique.upsertOne({
      select: {
        counter: true,
        status: true
      },
      insert: {
        id: randomUUID(),
        email: 'foo@test.com',
        counter: 1
      },
      update: {
        counter: {
          increment: 10
        }
      },
      where: {
        email: 'foo@test.com',
        status: 'active'
      }
    });

    deepEqual(result, {
      inserted: false,
      record: {
        counter: 11,
        status: 'active'
      }
    });
  });

  it('assert :: upsert one with extra filters not matching the existing record', async () => {
    await upsertCounter('foo@test.com', 'archived');

    await rejects(
      () =>
        client.ez4_test_unique.upsertOne({
          insert: {
            id: randomUUID(),
            email: 'foo@test.com',
            counter: 1
          },
          update: {
            counter: 100
          },
          where: {
            email: 'foo@test.com',
            status: 'active'
          }
        }),
      DuplicateUniqueKeyError
    );

    await rejects(
      () =>
        client.ez4_test_unique.upsertOne({
          insert: {
            id: randomUUID(),
            email: 'foo@test.com',
            counter: 1
          },
          update: {},
          where: {
            email: 'foo@test.com',
            status: 'active'
          }
        }),
      DuplicateUniqueKeyError
    );

    deepEqual(await findByEmail('foo@test.com'), {
      counter: 1,
      status: 'archived',
      json: null
    });
  });

  it('assert :: upsert one with previous concurrently inside transactions', async () => {
    const writers = ['v1', 'v2', 'v3', 'v4'];

    for (let round = 0; round < 10; round++) {
      const email = `key-${round}@test.com`;

      const results = await Promise.allSettled(
        writers.map((status) => {
          return client.transaction(async (transaction) => {
            return transaction.ez4_test_unique.upsertOne({
              previous: true,
              select: {
                status: true
              },
              insert: {
                id: randomUUID(),
                email,
                status
              },
              update: {
                status
              },
              where: {
                email
              }
            });
          });
        })
      );

      deepEqual(getFailures(results), []);

      const values = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));

      equal(values.filter(({ inserted }) => inserted).length, 1);

      const current = await findByEmail(email);

      // The inserted record is the first value, every update overwrites exactly one value and the last one stays.
      const overwritten = values.filter(({ inserted }) => !inserted).map(({ record }) => record.status);

      deepEqual([...overwritten, current?.status].sort(), [...writers].sort());
    }
  });

  it('assert :: upsert one with null in the unique index', async () => {
    const upsert = () => {
      return client.ez4_test_unique.upsertOne({
        select: {
          counter: true
        },
        insert: {
          id: randomUUID(),
          email: `${randomUUID()}@test.com`,
          tenant: null,
          slug: 'foo',
          counter: 1
        },
        update: {
          counter: {
            increment: 1
          }
        },
        where: {
          tenant: null,
          slug: 'foo'
        }
      });
    };

    deepEqual(await upsert(), {
      inserted: true,
      record: {
        counter: 1
      }
    });

    deepEqual(await upsert(), {
      inserted: false,
      record: {
        counter: 2
      }
    });

    equal(await client.ez4_test_unique.count({}), 1);
  });
};

describe('client upsert one (one statement)', upsertOneTests(false));

describe('client upsert one (one statement, data api)', upsertOneTests(true));

describe('client upsert one (relations)', () => {
  const { client, driver } = makeRecordingClient<TestRelationDb>(TestRelationRepository);

  beforeEach(async () => {
    await prepareRelationTables(client);
  });

  it('assert :: upsert one creating a relation before the record', async () => {
    const sourceId = randomUUID();
    const targetId = randomUUID();

    const upsert = (value: string) => {
      return client.table_a.upsertOne({
        select: {
          value: true,
          relation_1: {
            id_b: true,
            value: true
          }
        },
        insert: {
          id_a: sourceId,
          value,
          relation_1: {
            id_b: targetId,
            value: 'related'
          }
        },
        update: {
          value
        },
        where: {
          id_a: sourceId
        }
      });
    };

    deepEqual(await upsert('first'), {
      inserted: true,
      record: {
        value: 'first',
        relation_1: {
          id_b: targetId,
          value: 'related'
        }
      }
    });

    deepEqual(await upsert('second'), {
      inserted: false,
      record: {
        value: 'second',
        relation_1: {
          id_b: targetId,
          value: 'related'
        }
      }
    });
  });

  it('assert :: upsert one creating relations after the record', async () => {
    const sourceId = randomUUID();
    const targetId = randomUUID();

    const upsert = (value: string) => {
      return client.table_b.upsertOne({
        select: {
          value: true,
          relations: {
            id_a: true,
            value: true
          }
        },
        insert: {
          id_b: sourceId,
          value,
          relations: [
            {
              id_a: targetId,
              value: 'related'
            }
          ]
        },
        update: {
          value
        },
        where: {
          id_b: sourceId
        }
      });
    };

    deepEqual(await upsert('first'), {
      inserted: true,
      record: {
        value: 'first',
        relations: [
          {
            id_a: targetId,
            value: 'related'
          }
        ]
      }
    });

    deepEqual(await upsert('second'), {
      inserted: false,
      record: {
        value: 'second',
        relations: [
          {
            id_a: targetId,
            value: 'related'
          }
        ]
      }
    });
  });

  it('assert :: upsert one creating relations concurrently inside transactions', async () => {
    for (let round = 0; round < 10; round++) {
      const sourceId = randomUUID();

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, (_, index) => {
          return client.transaction(async (transaction) => {
            return transaction.table_b.upsertOne({
              insert: {
                id_b: sourceId,
                value: 'first',
                relations: [
                  {
                    id_a: randomUUID(),
                    value: `related-${index}`
                  }
                ]
              },
              update: {
                value: 'second'
              },
              where: {
                id_b: sourceId
              }
            });
          });
        })
      );

      deepEqual(getFailures(results), []);

      const inserted = results.filter((result) => result.status === 'fulfilled' && result.value.inserted);

      equal(inserted.length, 1);

      const record = await client.table_b.findOne({
        select: {
          value: true,
          relations: {
            id_a: true
          }
        },
        where: {
          id_b: sourceId
        }
      });

      equal(record?.value, 'second');
      equal(record?.relations.length, 1);
    }
  });

  it('assert :: upsert one selecting a connected relation in one statement', async () => {
    const sourceId = randomUUID();
    const targetId = randomUUID();

    await client.table_b.insertOne({
      data: {
        id_b: targetId,
        value: 'related'
      }
    });

    const upsert = (value: string) => {
      return client.table_a.upsertOne({
        select: {
          value: true,
          relation_1: {
            value: true
          }
        },
        insert: {
          id_a: sourceId,
          value,
          relation_1: {
            id_b: targetId
          }
        },
        update: {
          value
        },
        where: {
          id_a: sourceId
        }
      });
    };

    deepEqual(await upsert('first'), {
      inserted: true,
      record: {
        value: 'first',
        relation_1: {
          value: 'related'
        }
      }
    });

    driver.statements = [];

    deepEqual(await upsert('second'), {
      inserted: false,
      record: {
        value: 'second',
        relation_1: {
          value: 'related'
        }
      }
    });

    equal(driver.statements.length, 1);
  });

  it('assert :: upsert one keyed by a column the insert connects through a relation', async () => {
    const targetId = randomUUID();

    await client.table_b.insertOne({
      data: {
        id_b: targetId,
        value: 'related'
      }
    });

    const upsert = (value: string) => {
      return client.table_c.upsertOne({
        select: {
          value: true
        },
        insert: {
          id_c: randomUUID(),
          value,
          relation: {
            id_b: targetId
          }
        },
        update: {
          value
        },
        where: {
          unique_1_id: targetId
        }
      });
    };

    driver.statements = [];

    deepEqual(await upsert('first'), {
      inserted: true,
      record: {
        value: 'first'
      }
    });

    deepEqual(await upsert('second'), {
      inserted: false,
      record: {
        value: 'second'
      }
    });

    equal(driver.statements.length, 2);
  });

  it('assert :: upsert one with a relation filter on the existing record', async () => {
    const sourceId = randomUUID();
    const targetId = randomUUID();

    await client.table_a.insertOne({
      data: {
        id_a: sourceId,
        value: 'first',
        relation_1: {
          id_b: targetId,
          value: 'related'
        }
      }
    });

    const upsert = (relationValue: string) => {
      return client.table_a.upsertOne({
        select: {
          value: true
        },
        insert: {
          id_a: sourceId,
          value: 'inserted'
        },
        update: {
          value: `updated-${relationValue}`
        },
        where: {
          id_a: sourceId,
          relation_1: {
            value: relationValue
          }
        }
      });
    };

    await rejects(() => upsert('other'), DuplicateUniqueKeyError);

    deepEqual(await upsert('related'), {
      inserted: false,
      record: {
        value: 'updated-related'
      }
    });
  });
});
