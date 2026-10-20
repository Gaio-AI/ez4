import type { PgTableRepository } from '@ez4/pgclient/library';

import { before, describe, it } from 'node:test';
import { deepEqual, rejects } from 'assert/strict';

import { Client } from '@ez4/pgclient/driver';
import { getCreateQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { runMigration } from './common/migration';

describe('migration :: client index options tests', async () => {
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

  const repositoryV1: PgTableRepository = {
    index_options: {
      name: 'index_options',
      relations: {},
      schema: {
        type: SchemaType.Object,
        properties: {
          id: { type: SchemaType.String },
          alias: { type: SchemaType.String },
          created_at: { type: SchemaType.String },
          deleted_at: { type: SchemaType.String, nullable: true, optional: true }
        }
      },
      indexes: {
        id: { name: 'id', type: Index.Primary, columns: ['id'] }
      }
    }
  };

  const repositoryV2: PgTableRepository = {
    index_options: {
      ...repositoryV1.index_options,
      indexes: {
        ...repositoryV1.index_options.indexes,
        alias: {
          name: 'alias',
          type: Index.Unique,
          columns: ['alias'],
          options: {
            where: { deleted_at: null }
          }
        },
        'alias:created_at': {
          name: 'alias:created_at',
          type: Index.Secondary,
          columns: ['alias', 'created_at'],
          options: {
            name: 'index_options_recent_aliases',
            include: ['id'],
            order: { created_at: 'desc' }
          }
        }
      }
    }
  };

  before(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "index_options"`);
  });

  it('assert :: create indexes with options', async () => {
    await runMigration(client, getCreateQueries(repositoryV1));

    // Deleted rows repeat an alias, which a partial unique index leaves out.
    await client.rawQuery(`INSERT INTO "index_options" VALUES ('1', 'foo', '2026-01-01', '2026-01-02'), ('2', 'foo', '2026-01-03', NULL)`);

    const steps = getUpdateStepQueries(repositoryV2, repositoryV1);

    await runMigration(client, steps.prepare);
    await runMigration(client, steps.rollout);
    await runMigration(client, steps.cleanup, 'cleanup');

    const indexes = await client.rawQuery(
      `SELECT pg_get_indexdef(indexrelid) AS definition FROM pg_index ` +
        `WHERE indrelid = 'index_options'::regclass AND NOT indisprimary ORDER BY indexrelid::regclass::text`
    );

    deepEqual(indexes, [
      {
        definition: 'CREATE UNIQUE INDEX index_options_alias_uk ON public.index_options USING btree (alias) WHERE (deleted_at IS NULL)'
      },
      {
        definition: 'CREATE INDEX index_options_recent_aliases ON public.index_options USING btree (alias, created_at DESC) INCLUDE (id)'
      }
    ]);

    await rejects(client.rawQuery(`INSERT INTO "index_options" VALUES ('3', 'foo', '2026-01-04', NULL)`));
  });
});
