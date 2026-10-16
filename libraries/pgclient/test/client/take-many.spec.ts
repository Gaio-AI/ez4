import { makeSchemaClient, prepareSchemaTable } from './common/schema';

import { beforeEach, describe, it } from 'node:test';
import { equal } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

describe('client update and delete many with take', async () => {
  const client = await makeSchemaClient();

  beforeEach(async () => {
    await prepareSchemaTable(client);

    await client.ez4_test_table.insertMany({
      data: Array.from({ length: 7 }, (_, index) => ({
        id: randomUUID(),
        integer: index,
        string: index < 5 ? 'pending' : 'kept'
      }))
    });
  });

  const countByString = (string: string) => {
    return client.ez4_test_table.count({
      where: {
        string
      }
    });
  };

  it('assert :: update many (take)', async () => {
    await client.ez4_test_table.updateMany({
      data: {
        string: 'done'
      },
      where: {
        string: 'pending'
      },
      take: 2
    });

    equal(await countByString('done'), 2);
    equal(await countByString('pending'), 3);
    equal(await countByString('kept'), 2);
  });

  it('assert :: update many and select (take)', async () => {
    const records = await client.ez4_test_table.updateMany({
      select: {
        string: true
      },
      data: {
        string: 'done'
      },
      where: {
        string: 'pending'
      },
      take: 3
    });

    equal(records.length, 3);
    equal(
      records.every(({ string }) => string === 'done'),
      true
    );
    equal(await countByString('pending'), 2);
  });

  it('assert :: update many and select previous (take)', async () => {
    const records = await client.ez4_test_table.updateMany({
      select: {
        string: true
      },
      previous: true,
      data: {
        string: 'done'
      },
      where: {
        string: 'pending'
      },
      take: 2
    });

    equal(records.length, 2);
    equal(
      records.every(({ string }) => string === 'pending'),
      true
    );
    equal(await countByString('done'), 2);
  });

  it('assert :: update many in batches (take)', async () => {
    let batches = 0;

    while (true) {
      const records = await client.ez4_test_table.updateMany({
        select: {
          id: true
        },
        data: {
          string: 'done'
        },
        where: {
          string: 'pending'
        },
        take: 2
      });

      if (!records.length) {
        break;
      }

      batches++;
    }

    equal(batches, 3);
    equal(await countByString('done'), 5);
    equal(await countByString('kept'), 2);
  });

  it('assert :: delete many (take)', async () => {
    await client.ez4_test_table.deleteMany({
      where: {
        string: 'pending'
      },
      take: 2
    });

    equal(await countByString('pending'), 3);
    equal(await countByString('kept'), 2);
  });

  it('assert :: delete many and select (take)', async () => {
    const records = await client.ez4_test_table.deleteMany({
      select: {
        string: true
      },
      where: {
        string: 'pending'
      },
      take: 4
    });

    equal(records.length, 4);
    equal(await countByString('pending'), 1);
    equal(await countByString('kept'), 2);
  });
});
