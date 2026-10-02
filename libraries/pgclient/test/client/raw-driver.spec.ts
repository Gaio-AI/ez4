import type { Database, Client as DbClient } from '@ez4/database';
import type { PostgresEngine } from '@ez4/pgclient';

import { deepEqual, rejects } from 'assert/strict';
import { describe, it } from 'node:test';

import { DuplicateUniqueKeyError } from '@ez4/pgclient';
import { Client } from '@ez4/pgclient/driver';
import { DatabaseError } from 'pg';

declare class TestDb extends Database.Service<PostgresEngine> {
  tables: [];
}

describe('client raw driver', () => {
  const client = Client.make<TestDb>({
    debug: false,
    repository: {},
    connection: {
      database: 'postgres',
      password: 'postgres',
      user: 'postgres',
      host: '127.0.0.1'
    }
  });

  it('assert :: raw query', async () => {
    const result = await client.rawQuery('SELECT 1 AS alive');

    deepEqual(result, [{ alive: 1 }]);
  });

  it('assert :: raw query (with named bindings)', async () => {
    const result = await client.rawQuery('SELECT (:foo + :bar + :foo + :baz)::int AS alive', { bar: 2, foo: 1, baz: 4 });

    deepEqual(result, [{ alive: 8 }]);
  });

  it('assert :: raw query (with index bindings)', async () => {
    const result = await client.rawQuery('SELECT (:1 + :0 + :1 + :2)::int AS alive', [1, 2, 3]);

    deepEqual(result, [{ alive: 8 }]);
  });

  it('assert :: raw query (duplicate unique key)', async () => {
    const query = 'CREATE TEMP TABLE ez4_test_duplicate (id int PRIMARY KEY); INSERT INTO ez4_test_duplicate VALUES (1), (1)';

    await rejects(client.rawQuery(query), (error) => {
      return error instanceof DuplicateUniqueKeyError && error.cause instanceof DatabaseError && error.cause.code === '23505';
    });
  });

  it('assert :: transaction', async () => {
    const result = await client.transaction(async (transaction: DbClient<Database.Service<any>>) => {
      return transaction.rawQuery('SELECT 1 AS alive');
    });

    deepEqual(result, [{ alive: 1 }]);
  });

  it('assert :: transaction (nested)', async () => {
    const result = await client.transaction(async (transaction: DbClient<Database.Service<any>>) => {
      return transaction.transaction(async (innerTransaction: DbClient<Database.Service<any>>) => {
        return innerTransaction.rawQuery('SELECT 1 AS alive');
      });
    });

    deepEqual(result, [{ alive: 1 }]);
  });
});
