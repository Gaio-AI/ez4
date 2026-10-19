import type { PgTableRepository } from '@ez4/pgclient/library';
import type { ObjectSchemaProperties } from '@ez4/schema';
import type { TableIndex } from '@ez4/database/library';

import { before, describe, it } from 'node:test';
import { deepEqual, equal } from 'assert/strict';

import { Client } from '@ez4/pgclient/driver';
import { getCreateQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { runMigration } from './common/migration';

describe('migration :: client index changes tests', async () => {
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

  const textColumns = (...columns: string[]): ObjectSchemaProperties => {
    return Object.fromEntries(columns.map((column) => [column, { type: SchemaType.String }]));
  };

  const getRepository = (table: string, properties: ObjectSchemaProperties, indexes: TableIndex[]): PgTableRepository => {
    return {
      [table]: {
        name: table,
        relations: {},
        schema: {
          type: SchemaType.Object,
          properties
        },
        indexes: Object.fromEntries(indexes.map((index) => [index.name, index]))
      }
    };
  };

  const runSteps = async (target: PgTableRepository, source: PgTableRepository) => {
    const steps = getUpdateStepQueries(target, source);

    await runMigration(client, steps.prepare);
    await runMigration(client, steps.rollout);
    await runMigration(client, steps.cleanup);
  };

  const getIndexes = async (table: string) => {
    return client.rawQuery(
      `SELECT c.relname AS name, x.indisprimary AS primary, x.indisvalid AS valid, ` +
        `pg_get_indexdef(x.indexrelid) AS definition ` +
        `FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid ` +
        `WHERE x.indrelid = '"${table}"'::regclass ORDER BY c.relname`
    );
  };

  const getIndexId = async (name: string) => {
    const [record] = await client.rawQuery(`SELECT oid::text AS id FROM pg_class WHERE relname = '${name}'`);

    return record?.id;
  };

  before(async () => {
    for (const table of ['index_pk_swap', 'index_pk_swap_long', 'index_invalid', 'index_column_rename', 'index_type_change']) {
      await client.rawQuery(`DROP TABLE IF EXISTS "${table}"`);
    }
  });

  it('assert :: replace primary key of a table with records', async () => {
    const columns = textColumns('column_a', 'column_b');

    const repositoryV1 = getRepository('index_pk_swap', columns, [
      { name: 'column_a:column_b', type: Index.Primary, columns: ['column_a', 'column_b'] }
    ]);

    const repositoryV2 = getRepository('index_pk_swap', columns, [
      { name: 'column_b:column_a', type: Index.Primary, columns: ['column_b', 'column_a'] }
    ]);

    await runMigration(client, getCreateQueries(repositoryV1));

    await client.rawQuery(`INSERT INTO "index_pk_swap" VALUES ('a1', 'b1'), ('a2', 'b2')`);

    await runSteps(repositoryV2, repositoryV1);

    deepEqual(await getIndexes('index_pk_swap'), [
      {
        name: 'index_pk_swap_column_b_column_a_pk',
        primary: true,
        valid: true,
        definition: 'CREATE UNIQUE INDEX index_pk_swap_column_b_column_a_pk ON public.index_pk_swap USING btree (column_b, column_a)'
      }
    ]);

    const [{ total }] = await client.rawQuery(`SELECT count(*)::int AS total FROM "index_pk_swap"`);

    equal(total, 2);
  });

  it('assert :: replace primary key with a long name', async () => {
    const columns = textColumns('first_column_with_a_long_name', 'second_column_with_a_long_name');

    const repositoryV1 = getRepository('index_pk_swap_long', columns, [
      {
        name: 'first_column_with_a_long_name:second_column_with_a_long_name',
        type: Index.Primary,
        columns: ['first_column_with_a_long_name', 'second_column_with_a_long_name']
      }
    ]);

    const repositoryV2 = getRepository('index_pk_swap_long', columns, [
      {
        name: 'second_column_with_a_long_name:first_column_with_a_long_name',
        type: Index.Primary,
        columns: ['second_column_with_a_long_name', 'first_column_with_a_long_name']
      }
    ]);

    await runMigration(client, getCreateQueries(repositoryV1));

    await runSteps(repositoryV2, repositoryV1);

    deepEqual(
      (await getIndexes('index_pk_swap_long')).map(({ primary, valid, definition }) => ({ primary, valid, definition })),
      [
        {
          primary: true,
          valid: true,
          definition:
            'CREATE UNIQUE INDEX index_pk_swap_long_second_column_with_a_long_name_first_column_ ' +
            'ON public.index_pk_swap_long USING btree (second_column_with_a_long_name, first_column_with_a_long_name)'
        }
      ]
    );
  });

  it('assert :: rebuild an index left invalid', async () => {
    const columns = textColumns('id', 'column');

    const repositoryV1 = getRepository('index_invalid', columns, [{ name: 'id', type: Index.Primary, columns: ['id'] }]);

    const repositoryV2 = getRepository('index_invalid', columns, [
      { name: 'id', type: Index.Primary, columns: ['id'] },
      { name: 'column', type: Index.Unique, columns: ['column'] }
    ]);

    await runMigration(client, getCreateQueries(repositoryV1));

    // A concurrent build that fails on duplicates leaves the index in place, invalid.
    await client.rawQuery(`INSERT INTO "index_invalid" VALUES ('1', 'duplicate'), ('2', 'duplicate')`);
    await client.rawQuery(`CREATE UNIQUE INDEX CONCURRENTLY "index_invalid_column_uk" ON "index_invalid" ("column")`).catch(() => {});
    await client.rawQuery(`DELETE FROM "index_invalid" WHERE "id" = '2'`);

    deepEqual(
      (await getIndexes('index_invalid')).map(({ name, valid }) => ({ name, valid })),
      [
        { name: 'index_invalid_column_uk', valid: false },
        { name: 'index_invalid_id_pk', valid: true }
      ]
    );

    await runSteps(repositoryV2, repositoryV1);

    deepEqual(
      (await getIndexes('index_invalid')).map(({ name, valid }) => ({ name, valid })),
      [
        { name: 'index_invalid_column_uk', valid: true },
        { name: 'index_invalid_id_pk', valid: true }
      ]
    );
  });

  it('assert :: keep the index of a renamed column', async () => {
    const repositoryV1 = getRepository('index_column_rename', textColumns('id', 'old_value'), [
      { name: 'id', type: Index.Primary, columns: ['id'] },
      { name: 'old_value', type: Index.Secondary, columns: ['old_value'] }
    ]);

    const repositoryV2 = getRepository('index_column_rename', textColumns('id', 'new_value'), [
      { name: 'id', type: Index.Primary, columns: ['id'] },
      { name: 'new_value', type: Index.Secondary, columns: ['new_value'] }
    ]);

    await runMigration(client, getCreateQueries(repositoryV1));

    const indexId = await getIndexId('index_column_rename_old_value_sk');

    await runSteps(repositoryV2, repositoryV1);

    equal(await getIndexId('index_column_rename_new_value_sk'), indexId);
    equal(await getIndexId('index_column_rename_old_value_sk'), undefined);
  });

  it('assert :: drop the replaced index only in the cleanup', async () => {
    const columns = textColumns('id', 'column');

    const repositoryV1 = getRepository('index_type_change', columns, [
      { name: 'id', type: Index.Primary, columns: ['id'] },
      { name: 'column', type: Index.Unique, columns: ['column'] }
    ]);

    const repositoryV2 = getRepository('index_type_change', columns, [
      { name: 'id', type: Index.Primary, columns: ['id'] },
      { name: 'column', type: Index.Secondary, columns: ['column'] }
    ]);

    await runMigration(client, getCreateQueries(repositoryV1));

    const steps = getUpdateStepQueries(repositoryV2, repositoryV1);

    await runMigration(client, steps.prepare);
    await runMigration(client, steps.rollout);

    deepEqual(
      (await getIndexes('index_type_change')).map(({ name }) => name),
      ['index_type_change_column_sk', 'index_type_change_column_uk', 'index_type_change_id_pk']
    );

    await runMigration(client, steps.cleanup);

    deepEqual(
      (await getIndexes('index_type_change')).map(({ name }) => name),
      ['index_type_change_column_sk', 'index_type_change_id_pk']
    );
  });
});
