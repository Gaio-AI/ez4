import type { PgTableRepository } from '@ez4/pgclient/library';
import type { TableRenames } from '@ez4/database/library';
import type { AnySchema } from '@ez4/schema';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual } from 'assert/strict';

import { Client } from '@ez4/pgclient/driver';
import { getCreateQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { columnMetadata } from './common/queries';
import { runMigration } from './common/migration';

describe('migration :: client declared rename tests', async () => {
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

  const getRepository = (table: string, columns: Record<string, AnySchema>, renamedFrom?: TableRenames): PgTableRepository => ({
    [table]: {
      name: table,
      relations: {},
      schema: { type: SchemaType.Object, properties: columns },
      indexes: { id: { name: 'id', type: Index.Primary, columns: ['id'] } },
      ...(renamedFrom && { renamedFrom })
    }
  });

  const runSteps = async (target: PgTableRepository, source: PgTableRepository) => {
    const steps = getUpdateStepQueries(target, source);

    await runMigration(client, steps.prepare, 'prepare');
    await runMigration(client, steps.rollout, 'rollout');
    await runMigration(client, steps.cleanup, 'cleanup');
  };

  beforeEach(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "renamed_people"`);
    await client.rawQuery(`DROP TABLE IF EXISTS "renamed_contacts"`);
  });

  it('assert :: declared renames keep the data', async () => {
    const source = getRepository('renamed_people', { id: { type: SchemaType.String }, name: { type: SchemaType.String } });

    const target = getRepository(
      'renamed_contacts',
      { id: { type: SchemaType.String }, full_name: { type: SchemaType.String, optional: true } },
      { table: 'renamed_people', columns: { full_name: 'name' } }
    );

    await runMigration(client, getCreateQueries(source));

    await client.rawQuery(`INSERT INTO "renamed_people" VALUES ('person-a', 'Ada')`);

    await runSteps(target, source);

    deepEqual(await client.rawQuery(`SELECT "id", "full_name" FROM "renamed_contacts"`), [{ id: 'person-a', full_name: 'Ada' }]);

    deepEqual(await columnMetadata(client, 'renamed_contacts', 'full_name'), [
      {
        column_name: 'full_name',
        data_type: 'text',
        character_maximum_length: null,
        is_nullable: 'YES',
        column_default: null
      }
    ]);
  });
});
