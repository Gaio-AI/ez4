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

  it('assert :: statement holding a function body', async () => {
    const statement = {
      query:
        `CREATE OR REPLACE FUNCTION "lock_timeout_stamp"() RETURNS trigger LANGUAGE plpgsql AS ` +
        `$fn$ BEGIN NEW."value" := 'stamped'; RETURN NEW; END $fn$`
    };

    await client.rawQuery(getMigrationQuery(statement));

    await client.rawQuery(
      `CREATE OR REPLACE TRIGGER "lock_timeout_stamp" BEFORE INSERT ON "lock_timeout" FOR EACH ROW EXECUTE FUNCTION "lock_timeout_stamp"()`
    );

    await client.rawQuery(`INSERT INTO "lock_timeout" ("id", "value") VALUES ('stamp', 'given')`);

    const [record] = await client.rawQuery(`SELECT "value" FROM "lock_timeout" WHERE "id" = 'stamp'`);

    equal(record?.value, 'stamped');
  });

  it('assert :: trigger creation gives up waiting for a lock', async () => {
    const statement = {
      query: `CREATE TRIGGER "lock_timeout_waiting" BEFORE UPDATE ON "lock_timeout" FOR EACH ROW EXECUTE FUNCTION "lock_timeout_stamp"()`
    };

    // A transaction writing the table holds a lock that conflicts with the one creating a trigger takes.
    await otherClient.transaction(async (transaction: typeof otherClient) => {
      await transaction.rawQuery(`UPDATE "lock_timeout" SET "value" = "value" WHERE "id" = 'stamp'`);

      await rejects(client.rawQuery(getMigrationQuery(statement, '100ms')), (error: Error) => {
        equal(Reflect.get(error, 'code'), '55P03');
        return true;
      });
    });
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
