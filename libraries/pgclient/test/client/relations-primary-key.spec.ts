import { deletePrimaryRelationTables, makePrimaryRelationClient, preparePrimaryRelationTables } from './common/primary-relation';

import { after, beforeEach, describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

describe('client primary key relations', () => {
  const { client, driver } = makePrimaryRelationClient();

  const insertAccount = (id: string, value: string) => {
    return client.table_account.insertOne({
      data: {
        id,
        value
      }
    });
  };

  const findAccount = (id: string) => {
    return client.table_account.findOne({
      select: {
        id: true,
        value: true
      },
      where: {
        id
      }
    });
  };

  const findStats = (accountId: string) => {
    return client.table_account_stats.findOne({
      select: {
        account_id: true,
        total: true,
        account: {
          id: true,
          value: true
        }
      },
      where: {
        account_id: accountId
      }
    });
  };

  beforeEach(async () => {
    await preparePrimaryRelationTables(client);

    driver.statements = [];
  });

  after(async () => {
    await deletePrimaryRelationTables(client);
  });

  it('assert :: insert one and connect relation (primary to primary)', async () => {
    const accountId = randomUUID();

    await insertAccount(accountId, 'foo');

    const result = await client.table_account_stats.insertOne({
      select: {
        account_id: true,
        total: true,
        account: {
          id: true,
          value: true
        }
      },
      data: {
        total: 1,
        account: {
          id: accountId
        }
      }
    });

    deepEqual(result, {
      account_id: accountId,
      total: 1,
      account: {
        id: accountId,
        value: 'foo'
      }
    });

    deepEqual(await findAccount(accountId), {
      id: accountId,
      value: 'foo'
    });
  });

  it('assert :: insert one and create relation (primary to primary)', async () => {
    const accountId = randomUUID();

    await client.table_account_stats.insertOne({
      data: {
        total: 1,
        account: {
          id: accountId,
          value: 'foo'
        }
      }
    });

    deepEqual(await findStats(accountId), {
      account_id: accountId,
      total: 1,
      account: {
        id: accountId,
        value: 'foo'
      }
    });
  });

  it('assert :: upsert one and connect relation (primary to primary)', async () => {
    const accountId = randomUUID();

    await insertAccount(accountId, 'foo');

    driver.statements = [];

    const upsertStats = (total: number) => {
      return client.table_account_stats.upsertOne({
        select: {
          account_id: true,
          total: true
        },
        insert: {
          total,
          account: {
            id: accountId
          }
        },
        update: {
          total
        },
        where: {
          account_id: accountId
        }
      });
    };

    deepEqual(await upsertStats(1), {
      inserted: true,
      record: {
        account_id: accountId,
        total: 1
      }
    });

    deepEqual(await upsertStats(2), {
      inserted: false,
      record: {
        account_id: accountId,
        total: 2
      }
    });

    // One `INSERT … ON CONFLICT` statement for each call.
    equal(driver.statements.length, 2);

    deepEqual(await findAccount(accountId), {
      id: accountId,
      value: 'foo'
    });
  });

  it('assert :: insert many (primary to primary)', async () => {
    const accountAId = randomUUID();
    const accountBId = randomUUID();

    await insertAccount(accountAId, 'foo');
    await insertAccount(accountBId, 'bar');

    await client.table_account_stats.insertMany({
      data: [
        {
          account_id: accountAId,
          total: 1
        },
        {
          account_id: accountBId,
          total: 2
        }
      ]
    });

    deepEqual(await findStats(accountAId), {
      account_id: accountAId,
      total: 1,
      account: {
        id: accountAId,
        value: 'foo'
      }
    });

    deepEqual(await findStats(accountBId), {
      account_id: accountBId,
      total: 2,
      account: {
        id: accountBId,
        value: 'bar'
      }
    });
  });
});
