import type { PgTableRepository } from '@ez4/pgclient/library';
import type { TableTimestamps } from '@ez4/database/library';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual, equal, notEqual } from 'assert/strict';

import { getCreateQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { Client } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { runMigration } from './common/migration';

describe('migration :: client timestamps tests', () => {
  const client = Client.make({
    debug: false,
    repository: {},
    connection: {
      database: 'postgres',
      password: 'postgres',
      user: 'postgres',
      host: '127.0.0.1'
    }
  });

  const getRepository = (timestamps?: TableTimestamps): PgTableRepository => {
    return {
      stamped_records: {
        name: 'stamped_records',
        relations: {},
        ...(timestamps && { timestamps }),
        indexes: {
          id: {
            name: 'id',
            type: Index.Primary,
            columns: ['id']
          }
        },
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            name: { type: SchemaType.String },
            created_at: { type: SchemaType.String, format: 'date-time' },
            updated_at: { type: SchemaType.String, format: 'date-time' }
          }
        }
      }
    };
  };

  const plainRepository = getRepository();
  const stampedRepository = getRepository({ created: 'created_at', updated: 'updated_at' });

  // Read in SQL, so the comparison doesn't depend on how the driver parses a timestamp.
  const readRecord = async (id: string) => {
    const [record] = await client.rawQuery(
      `SELECT "name", ` +
        `to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "created_at", ` +
        `to_char("updated_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "updated_at", ` +
        `"created_at" = "updated_at" AS "same", ` +
        `"created_at" = date_trunc('milliseconds', "created_at") AND "updated_at" = date_trunc('milliseconds', "updated_at") AS "truncated" ` +
        `FROM "stamped_records" WHERE "id" = '${id}'`
    );

    return record;
  };

  const getRelationFile = async () => {
    const [record] = await client.rawQuery(`SELECT "relfilenode"::text AS "file" FROM "pg_class" WHERE "relname" = 'stamped_records'`);

    return record?.file;
  };

  const getStampObjects = async () => {
    const [record] = await client.rawQuery(
      `SELECT ` +
        `(SELECT count(*)::int FROM "pg_trigger" WHERE "tgname" = 'ez4_stamp_updated_at' AND "tgrelid" = to_regclass('"stamped_records"')) AS "triggers", ` +
        `(SELECT count(*)::int FROM "pg_proc" WHERE "proname" = 'ez4_stamp_updated_at') AS "functions", ` +
        `(SELECT count(*)::int FROM "information_schema"."columns" WHERE "table_name" = 'stamped_records' ` +
        `AND "column_default" = 'date_trunc(''milliseconds''::text, statement_timestamp())') AS "defaults"`
    );

    return record;
  };

  const OLD_TIME = '2020-01-01T00:00:00.123456';

  beforeEach(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "stamped_records"`);
    await client.rawQuery(`DROP FUNCTION IF EXISTS "ez4_stamp_updated_at"()`);
  });

  it('assert :: insert without the timestamps', async () => {
    await runMigration(client, getCreateQueries(stampedRepository));

    await client.rawQuery(`INSERT INTO "stamped_records" ("id", "name") VALUES ('a', 'foo')`);

    const record = await readRecord('a');

    equal(record?.same, true);
    equal(record?.truncated, true);
  });

  it('assert :: update bumps the update timestamp and keeps the creation one', async () => {
    await runMigration(client, getCreateQueries(stampedRepository));

    await client.rawQuery(`INSERT INTO "stamped_records" VALUES ('a', 'foo', '${OLD_TIME}Z', '${OLD_TIME}Z')`);

    await client.rawQuery(`UPDATE "stamped_records" SET "name" = 'bar' WHERE "id" = 'a'`);

    const record = await readRecord('a');

    equal(record?.created_at, OLD_TIME);
    notEqual(record?.updated_at, OLD_TIME);
    equal(record?.truncated, false);

    const [{ bumped }] = await client.rawQuery(
      `SELECT "updated_at" = date_trunc('milliseconds', "updated_at") AND "updated_at" > now() - interval '1 minute' AS "bumped" ` +
        `FROM "stamped_records" WHERE "id" = 'a'`
    );

    equal(bumped, true);
  });

  it('assert :: update writing the timestamp is overridden', async () => {
    await runMigration(client, getCreateQueries(stampedRepository));

    await client.rawQuery(`INSERT INTO "stamped_records" ("id", "name") VALUES ('a', 'foo')`);

    await client.rawQuery(`UPDATE "stamped_records" SET "updated_at" = '${OLD_TIME}Z' WHERE "id" = 'a'`);

    const record = await readRecord('a');

    notEqual(record?.updated_at, OLD_TIME);
    equal(record?.truncated, true);
  });

  it('assert :: insert updating on conflict bumps the update timestamp', async () => {
    await runMigration(client, getCreateQueries(stampedRepository));

    await client.rawQuery(`INSERT INTO "stamped_records" VALUES ('a', 'foo', '${OLD_TIME}Z', '${OLD_TIME}Z')`);

    await client.rawQuery(
      `INSERT INTO "stamped_records" ("id", "name") VALUES ('a', 'bar') ON CONFLICT ("id") DO UPDATE SET "name" = "excluded"."name"`
    );

    const record = await readRecord('a');

    equal(record?.name, 'bar');
    equal(record?.created_at, OLD_TIME);
    notEqual(record?.updated_at, OLD_TIME);
  });

  it('assert :: table with records gains timestamps without a rewrite', async () => {
    await runMigration(client, getCreateQueries(plainRepository));

    await client.rawQuery(`INSERT INTO "stamped_records" VALUES ('a', 'foo', '${OLD_TIME}Z', '${OLD_TIME}Z')`);

    const fileBefore = await getRelationFile();

    const steps = getUpdateStepQueries(stampedRepository, plainRepository);

    await runMigration(client, steps.prepare, 'prepare');

    deepEqual(await getStampObjects(), { triggers: 1, functions: 1, defaults: 2 });

    // The records and the table file are the ones it had.
    equal(await getRelationFile(), fileBefore);

    deepEqual(await readRecord('a'), {
      name: 'foo',
      created_at: OLD_TIME,
      updated_at: OLD_TIME,
      same: true,
      truncated: false
    });

    // Running it again finds everything in place.
    await runMigration(client, steps.prepare, 'prepare');

    deepEqual(await getStampObjects(), { triggers: 1, functions: 1, defaults: 2 });

    equal(await getRelationFile(), fileBefore);

    await client.rawQuery(`INSERT INTO "stamped_records" ("id", "name") VALUES ('b', 'bar')`);
    await client.rawQuery(`UPDATE "stamped_records" SET "name" = 'baz' WHERE "id" = 'a'`);

    equal((await readRecord('b'))?.same, true);
    notEqual((await readRecord('a'))?.updated_at, OLD_TIME);
  });

  it('assert :: table dropping timestamps', async () => {
    await runMigration(client, getCreateQueries(stampedRepository));

    deepEqual(await getStampObjects(), { triggers: 1, functions: 1, defaults: 2 });

    const steps = getUpdateStepQueries(plainRepository, stampedRepository);

    await runMigration(client, steps.cleanup, 'cleanup');

    deepEqual(await getStampObjects(), { triggers: 0, functions: 0, defaults: 0 });

    await client.rawQuery(`INSERT INTO "stamped_records" VALUES ('a', 'foo', '${OLD_TIME}Z', '${OLD_TIME}Z')`);
    await client.rawQuery(`UPDATE "stamped_records" SET "name" = 'bar' WHERE "id" = 'a'`);

    equal((await readRecord('a'))?.updated_at, OLD_TIME);
  });
});
