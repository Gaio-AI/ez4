import type { PgTableRepository } from '@ez4/pgclient/library';

import { after, describe, it } from 'node:test';
import { deepEqual, equal, notEqual } from 'assert/strict';

import { Client } from '@ez4/pgclient/driver';
import { getCreateQueries, getDeleteQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { runMigration } from './common/migration';

describe('migration :: client relation against the catalog tests', async () => {
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

  const relationName = 'catalog_a_catalog_b_id_fk';

  // The column takes null, so the relation clears it on delete unless it says otherwise.
  const repositoryV1: PgTableRepository = {
    catalog_b: {
      name: 'catalog_b',
      relations: {},
      schema: {
        type: SchemaType.Object,
        properties: {
          id: {
            type: SchemaType.String,
            format: 'uuid'
          }
        }
      },
      indexes: {
        id: {
          type: Index.Primary,
          columns: ['id'],
          name: 'id'
        }
      }
    },
    catalog_a: {
      name: 'catalog_a',
      schema: {
        type: SchemaType.Object,
        properties: {
          id: {
            type: SchemaType.String,
            format: 'uuid'
          },
          catalog_b_id: {
            type: SchemaType.String,
            format: 'uuid',
            optional: true
          }
        }
      },
      indexes: {
        id: {
          type: Index.Primary,
          columns: ['id'],
          name: 'id'
        }
      },
      relations: {
        catalog_b_id: {
          sourceTable: 'catalog_b',
          sourceColumn: 'id',
          sourceIndex: Index.Primary,
          targetColumn: 'catalog_b_id'
        }
      }
    }
  };

  const repositoryV2: PgTableRepository = {
    catalog_b: repositoryV1.catalog_b,
    catalog_a: {
      ...repositoryV1.catalog_a,
      relations: {
        catalog_b_id: {
          ...repositoryV1.catalog_a.relations.catalog_b_id,
          onDelete: 'cascade'
        }
      }
    }
  };

  const readKey = async () => {
    const [key] = await client.rawQuery(
      `SELECT oid::text AS oid, confdeltype::text AS action, convalidated AS valid FROM pg_constraint WHERE conname = '${relationName}'`
    );

    return key as { oid: string; action: string; valid: boolean } | undefined;
  };

  const temporaryKeys = () => {
    return client.rawQuery(`SELECT conname FROM pg_constraint WHERE conname LIKE 'catalog_a_%tmp%'`);
  };

  // Recreates the key by hand with another delete action, as a key made before the contract
  // declared its action holds it.
  const recreateKey = async (action: 'CASCADE' | 'SET NULL') => {
    await client.rawQuery(`ALTER TABLE catalog_a DROP CONSTRAINT ${relationName}`);

    await client.rawQuery(
      `ALTER TABLE catalog_a ADD CONSTRAINT ${relationName} FOREIGN KEY (catalog_b_id) REFERENCES catalog_b(id) ON UPDATE CASCADE ON DELETE ${action}`
    );
  };

  const migrate = async () => {
    const steps = getUpdateStepQueries(repositoryV2, repositoryV1);

    await runMigration(client, steps.prepare);
    await runMigration(client, steps.rollout);
    await runMigration(client, steps.cleanup, 'cleanup');
  };

  after(async () => {
    await runMigration(client, getDeleteQueries(repositoryV2));
  });

  it('assert :: create tables', async () => {
    await runMigration(client, getCreateQueries(repositoryV1));

    equal((await readKey())?.action, 'n');
  });

  // Declaring the action the catalog already holds must not rebuild the key: validating a new one
  // reads the whole table, under a lock that holds back the writes.
  it('assert :: keep a key the catalog already holds as declared', async () => {
    await recreateKey('CASCADE');

    const before = await readKey();

    await migrate();

    const kept = await readKey();

    deepEqual(kept, before);
    deepEqual(await temporaryKeys(), []);
  });

  it('assert :: replace a key the catalog holds otherwise', async () => {
    await recreateKey('SET NULL');

    const before = await readKey();

    await migrate();

    const replaced = await readKey();

    notEqual(replaced?.oid, before?.oid);
    deepEqual({ action: replaced?.action, valid: replaced?.valid }, { action: 'c', valid: true });
    deepEqual(await temporaryKeys(), []);
  });
});
