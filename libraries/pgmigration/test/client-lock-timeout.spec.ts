import { before, describe, it } from 'node:test';
import { equal, rejects } from 'assert/strict';

import { getMigrationQuery } from '@ez4/pgmigration/library';
import { Client } from '@ez4/pgclient/driver';

describe('migration :: client lock timeout tests', async () => {
  const getClient = () => {
    return Client.make({
      debug: false,
      repository: {},
      connection: {
        database: 'postgres',
        password: 'postgres',
        user: 'postgres',
        host: '127.0.0.1'
      }
    });
  };

  const client = getClient();
  const otherClient = getClient();

  before(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "lock_timeout"`);
    await client.rawQuery(`CREATE TABLE "lock_timeout" ("id" text PRIMARY KEY, "value" text)`);
  });

  it('assert :: statement gives up waiting for a lock', async () => {
    const statement = {
      query: `ALTER TABLE IF EXISTS "lock_timeout" ADD COLUMN IF NOT EXISTS "other" text`
    };

    // A transaction reading the table holds a lock the statement waits for.
    await otherClient.transaction(async (transaction: typeof otherClient) => {
      await transaction.rawQuery(`SELECT 1 FROM "lock_timeout"`);

      await rejects(client.rawQuery(getMigrationQuery(statement, '100ms')), (error: Error) => {
        equal(Reflect.get(error, 'code'), '55P03');
        return true;
      });
    });

    await client.rawQuery(getMigrationQuery(statement, '100ms'));

    const [column] = await client.rawQuery(
      `SELECT 1 AS found FROM information_schema.columns WHERE table_name = 'lock_timeout' AND column_name = 'other'`
    );

    equal(column?.found, 1);
  });

  it('assert :: statement holding the dollar quote tag', async () => {
    const statement = {
      query: `ALTER TABLE IF EXISTS "lock_timeout" ALTER COLUMN "value" SET DEFAULT '$ez4$'`
    };

    await client.rawQuery(getMigrationQuery(statement));

    const [column] = await client.rawQuery(
      `SELECT column_default AS value FROM information_schema.columns WHERE table_name = 'lock_timeout' AND column_name = 'value'`
    );

    equal(column?.value, `'$ez4$'::text`);
  });

  it('assert :: concurrent statement runs as it is', async () => {
    const statement = {
      query: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "lock_timeout_value_sk" ON "lock_timeout" ("value")`,
      concurrent: true
    };

    equal(getMigrationQuery(statement), statement.query);

    await client.rawQuery(getMigrationQuery(statement));
  });
});
