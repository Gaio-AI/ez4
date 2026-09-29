import type { PgTableRepository } from '@ez4/pgclient/library';

import { after, before, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { deepEqual } from 'assert/strict';

import { getCreateQueries } from '@ez4/pgmigration';
import { Client } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: client validation tests', () => {
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

  const repository: PgTableRepository = {
    running_validation: {
      name: 'running_validation',
      relations: {},
      schema: {
        type: SchemaType.Object,
        properties: {
          id: {
            type: SchemaType.Number,
            format: 'integer'
          },
          status: {
            type: SchemaType.Enum,
            options: [{ value: 'on' }, { value: 'off' }]
          },
          value: {
            type: SchemaType.String
          }
        }
      },
      indexes: {
        id: {
          type: Index.Primary,
          columns: ['id'],
          name: 'id'
        },
        value: {
          type: Index.Secondary,
          columns: ['value'],
          name: 'value'
        }
      }
    }
  };

  const { validations } = getCreateQueries(repository);

  const isValidationRunning = async (name: string) => {
    const validation = validations.find((validation) => validation.name === name);

    if (!validation?.retry) {
      throw new Error(`Validation ${name} has no retry query.`);
    }

    const records = await client.rawQuery(validation.retry);

    return records.length > 0;
  };

  const waitForStatement = async (prefix: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const records = await client.rawQuery(
        `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" LIKE '${prefix}%'`
      );

      if (records.length) {
        return;
      }

      await setTimeout(20);
    }

    throw new Error(`Statement ${prefix} never started.`);
  };

  before(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "running_validation"`);
    await client.rawQuery(`CREATE TABLE "running_validation" ("id" integer, "status" text, "value" text)`);
    await client.rawQuery(`INSERT INTO "running_validation" VALUES (1, 'on', 'value')`);

    // Each row costs a second to index or to check, which keeps the statements below running while
    // the retry query looks for them.
    await client.rawQuery(
      `CREATE OR REPLACE FUNCTION "running_validation_sleep" ("input" text) RETURNS text ` +
        `LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN PERFORM pg_sleep(1); RETURN "input"; END $$`
    );
  });

  after(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "running_validation"`);
    await client.rawQuery(`DROP FUNCTION IF EXISTS "running_validation_sleep"`);
  });

  it('assert :: nothing running', async () => {
    const result = await Promise.all([
      isValidationRunning('running_validation_value_sk'),
      isValidationRunning('running_validation_status_ck')
    ]);

    deepEqual(result, [false, false]);
  });

  it('assert :: index build running', async () => {
    const statement = client.rawQuery(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "running_validation_value_sk" ` +
        `ON "running_validation" ("running_validation_sleep"("value"))`
    );

    try {
      await waitForStatement('CREATE INDEX CONCURRENTLY IF NOT EXISTS "running_validation_value_sk"');

      deepEqual(await isValidationRunning('running_validation_value_sk'), true);
    } finally {
      await statement;
    }
  });

  it('assert :: constraint validation running', async () => {
    await client.rawQuery(
      `ALTER TABLE "running_validation" ADD CONSTRAINT "running_validation_status_ck" ` +
        `CHECK ("running_validation_sleep"("status") IS NOT NULL) NOT VALID`
    );

    const statement = client.rawQuery(`ALTER TABLE "running_validation" VALIDATE CONSTRAINT "running_validation_status_ck"`);

    try {
      await waitForStatement('ALTER TABLE "running_validation" VALIDATE CONSTRAINT "running_validation_status_ck"');

      deepEqual(await isValidationRunning('running_validation_status_ck'), true);
    } finally {
      await statement;
    }
  });
});
