import type { PgTableRepository } from '@ez4/pgclient/library';

import { after, beforeEach, describe, it } from 'node:test';
import { deepEqual } from 'assert/strict';

import { getCreateQueries, getDeleteQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { Client } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';

import { columnMetadata } from './common/queries';
import { runMigration } from './common/migration';

describe('migration :: client column length tests', () => {
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

  const getRepository = (maxLength: number): PgTableRepository => {
    return {
      column_length_changes: {
        name: 'column_length_changes',
        indexes: {},
        relations: {},
        schema: {
          type: SchemaType.Object,
          properties: {
            label: {
              type: SchemaType.String,
              definitions: {
                maxLength
              }
            }
          }
        }
      }
    };
  };

  const sourceRepository = getRepository(10);

  const migrateLength = async (maxLength: number) => {
    const steps = getUpdateStepQueries(getRepository(maxLength), sourceRepository);

    try {
      await runMigration(client, steps.prepare);
      await runMigration(client, steps.rollout);
      await runMigration(client, steps.cleanup, 'cleanup');

      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : `${error}`;
    }
  };

  const insertLabels = async (labels: string[]) => {
    for (const label of labels) {
      await client.rawQuery(`INSERT INTO "column_length_changes" ("label") VALUES ('${label}')`);
    }
  };

  const getLabels = async () => {
    const rows = await client.rawQuery(`SELECT "label" FROM "column_length_changes" ORDER BY "label"`);

    return rows.map(({ label }) => label);
  };

  const getMaxLength = async () => {
    const [{ character_maximum_length }] = await columnMetadata(client, 'column_length_changes', 'label');

    return character_maximum_length;
  };

  const getFileNode = async () => {
    const [{ filenode }] = await client.rawQuery(`SELECT pg_relation_filenode('column_length_changes')::text AS "filenode"`);

    return filenode;
  };

  beforeEach(async () => {
    await runMigration(client, getDeleteQueries(sourceRepository));
    await runMigration(client, getCreateQueries(sourceRepository));
  });

  after(async () => {
    await runMigration(client, getDeleteQueries(sourceRepository));
  });

  it('assert :: decrease column maximum length below a stored value', async () => {
    await insertLabels(['short', 'ten chars!']);

    deepEqual(
      {
        error: await migrateLength(5),
        maxLength: await getMaxLength(),
        labels: await getLabels()
      },
      {
        error: 'value too long for type character varying(5)',
        maxLength: 10,
        labels: ['short', 'ten chars!']
      }
    );
  });

  it('assert :: decrease column maximum length above every stored value', async () => {
    await insertLabels(['short', 'tiny']);

    deepEqual(
      {
        error: await migrateLength(5),
        maxLength: await getMaxLength(),
        labels: await getLabels()
      },
      {
        error: undefined,
        maxLength: 5,
        labels: ['short', 'tiny']
      }
    );
  });

  it('assert :: increase column maximum length without rewriting the table', async () => {
    await insertLabels(['short', 'ten chars!']);

    const fileNode = await getFileNode();

    deepEqual(
      {
        error: await migrateLength(100),
        maxLength: await getMaxLength(),
        labels: await getLabels(),
        fileNode: await getFileNode()
      },
      {
        error: undefined,
        maxLength: 100,
        labels: ['short', 'ten chars!'],
        fileNode
      }
    );
  });
});
