import { makeTimestampsClient, prepareTimestampsTables } from './common/timestamps';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual, equal, match, notEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const OLD_TIME = '2020-01-01T00:00:00.123Z';

describe('client timestamps', async () => {
  const client = await makeTimestampsClient();

  beforeEach(async () => {
    await prepareTimestampsTables(client);
  });

  const insertOldAccount = async (id: string) => {
    await client.ez4_stamped_accounts.insertOne({
      data: {
        id,
        name: 'foo',
        created_at: OLD_TIME,
        updated_at: OLD_TIME
      }
    });
  };

  const findAccount = (id: string) => {
    return client.ez4_stamped_accounts.findOne({
      select: {
        name: true,
        created_at: true,
        updated_at: true
      },
      where: {
        id
      }
    });
  };

  it('assert :: insert one without the timestamps', async () => {
    const result = await client.ez4_stamped_accounts.insertOne({
      select: {
        created_at: true,
        updated_at: true
      },
      data: {
        id: randomUUID(),
        name: 'foo'
      }
    });

    match(result.created_at, DATE_TIME);
    equal(result.updated_at, result.created_at);
  });

  it('assert :: insert one with the timestamps', async () => {
    const id = randomUUID();

    await insertOldAccount(id);

    deepEqual(await findAccount(id), {
      name: 'foo',
      created_at: OLD_TIME,
      updated_at: OLD_TIME
    });
  });

  it('assert :: insert many without the timestamps', async () => {
    const result = await client.ez4_stamped_accounts.insertMany({
      select: {
        name: true,
        created_at: true,
        updated_at: true
      },
      data: [
        { id: randomUUID(), name: 'foo' },
        { id: randomUUID(), name: 'bar', created_at: OLD_TIME, updated_at: OLD_TIME }
      ]
    });

    const [first, second] = result;

    match(first.created_at, DATE_TIME);
    equal(first.updated_at, first.created_at);

    deepEqual(second, {
      name: 'bar',
      created_at: OLD_TIME,
      updated_at: OLD_TIME
    });
  });

  it('assert :: upsert one without the timestamps', async () => {
    const id = randomUUID();

    const upsert = (name: string) => {
      return client.ez4_stamped_accounts.upsertOne({
        select: {
          created_at: true,
          updated_at: true
        },
        insert: {
          id,
          name
        },
        update: {
          name
        },
        where: {
          id
        }
      });
    };

    const inserted = await upsert('foo');

    equal(inserted.inserted, true);
    match(inserted.record.created_at, DATE_TIME);
    equal(inserted.record.updated_at, inserted.record.created_at);

    const otherId = randomUUID();

    await insertOldAccount(otherId);

    const updated = await client.ez4_stamped_accounts.upsertOne({
      select: {
        name: true,
        created_at: true,
        updated_at: true
      },
      insert: {
        id: otherId,
        name: 'bar'
      },
      update: {
        name: 'bar'
      },
      where: {
        id: otherId
      }
    });

    equal(updated.inserted, false);
    equal(updated.record.name, 'bar');
    equal(updated.record.created_at, OLD_TIME);
    notEqual(updated.record.updated_at, OLD_TIME);
    match(updated.record.updated_at, DATE_TIME);
  });

  it('assert :: update one without the timestamps', async () => {
    const id = randomUUID();

    await insertOldAccount(id);

    // A caller without the types can still give them: the creation timestamp stays as it is.
    const data = { name: 'bar', created_at: '2000-01-01T00:00:00.000Z' };

    await client.ez4_stamped_accounts.updateOne({
      data,
      where: {
        id
      }
    });

    const record = await findAccount(id);

    equal(record?.name, 'bar');
    equal(record?.created_at, OLD_TIME);
    notEqual(record?.updated_at, OLD_TIME);
  });

  it('assert :: update one touching the record', async () => {
    const id = randomUUID();

    await insertOldAccount(id);

    // Without touch, an update with nothing to write only reads the record.
    const unchanged = await client.ez4_stamped_accounts.updateOne({
      select: {
        updated_at: true
      },
      data: {},
      where: {
        id
      }
    });

    equal(unchanged?.updated_at, OLD_TIME);

    const touched = await client.ez4_stamped_accounts.updateOne({
      touch: true,
      select: {
        updated_at: true
      },
      data: {},
      where: {
        id
      }
    });

    notEqual(touched?.updated_at, OLD_TIME);
    match(touched!.updated_at, DATE_TIME);

    deepEqual(await findAccount(id), {
      name: 'foo',
      created_at: OLD_TIME,
      updated_at: touched?.updated_at
    });
  });

  it('assert :: update one touching the record (previous)', async () => {
    const id = randomUUID();

    await insertOldAccount(id);

    const previous = await client.ez4_stamped_accounts.updateOne({
      touch: true,
      previous: true,
      select: {
        updated_at: true
      },
      data: {},
      where: {
        id
      }
    });

    equal(previous?.updated_at, OLD_TIME);
    notEqual((await findAccount(id))?.updated_at, OLD_TIME);
  });

  it('assert :: update many touching the records', async () => {
    const ids = [randomUUID(), randomUUID()];

    await Promise.all(ids.map((id) => insertOldAccount(id)));

    await client.ez4_stamped_accounts.updateMany({
      touch: true,
      data: {},
      where: {
        id: {
          isIn: ids
        }
      }
    });

    for (const id of ids) {
      notEqual((await findAccount(id))?.updated_at, OLD_TIME);
    }
  });

  it('assert :: related records without the timestamps', async () => {
    const result = await client.ez4_stamped_accounts.insertOne({
      select: {
        profile: {
          created_at: true,
          updated_at: true
        },
        notes: {
          created_at: true
        }
      },
      data: {
        id: randomUUID(),
        name: 'foo',
        profile: {
          id: randomUUID(),
          bio: 'bar'
        },
        notes: [
          {
            id: randomUUID(),
            text: 'baz'
          }
        ]
      }
    });

    match(result.profile!.created_at, DATE_TIME);
    equal(result.profile!.updated_at, result.profile!.created_at);
    match(result.notes[0].created_at, DATE_TIME);
  });

  it('assert :: related record updated without the timestamps', async () => {
    const id = randomUUID();

    await client.ez4_stamped_accounts.insertOne({
      data: {
        id,
        name: 'foo',
        profile: {
          id: randomUUID(),
          bio: 'bar',
          created_at: OLD_TIME,
          updated_at: OLD_TIME
        }
      }
    });

    // The related record keeps its creation timestamp, and the database writes its update timestamp.
    const profile = { bio: 'qux', created_at: '2000-01-01T00:00:00.000Z' };

    const updated = await client.ez4_stamped_accounts.updateOne({
      select: {
        profile: {
          bio: true,
          created_at: true,
          updated_at: true
        }
      },
      data: {
        profile
      },
      where: {
        id
      }
    });

    equal(updated?.profile?.bio, 'qux');
    equal(updated?.profile?.created_at, OLD_TIME);
    notEqual(updated?.profile?.updated_at, OLD_TIME);
  });

  it('assert :: transaction without the timestamps', async () => {
    const id = randomUUID();

    await client.transaction({
      ez4_stamped_accounts: [
        {
          insert: {
            data: {
              id,
              name: 'foo'
            }
          }
        }
      ]
    });

    const record = await findAccount(id);

    match(record!.created_at, DATE_TIME);
    equal(record?.updated_at, record?.created_at);
  });
});
