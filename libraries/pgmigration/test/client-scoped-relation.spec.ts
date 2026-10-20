import type { PgTableRepository } from '@ez4/pgclient/library';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual, rejects } from 'assert/strict';

import { Client } from '@ez4/pgclient/driver';
import { getCreateQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { runMigration } from './common/migration';

describe('migration :: client scoped relation tests', async () => {
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

  // Without a scope, the contacts table has no key on the account and the contact either.
  const getRepository = (scope?: string[]): PgTableRepository => ({
    scoped_contacts: {
      name: 'scoped_contacts',
      relations: {},
      schema: {
        type: SchemaType.Object,
        properties: {
          id: { type: SchemaType.String },
          account_id: { type: SchemaType.String }
        }
      },
      indexes: {
        id: { name: 'id', type: Index.Primary, columns: ['id'] },
        ...(scope && {
          'account_id:id': { name: 'account_id:id', type: Index.Unique, columns: ['account_id', 'id'] }
        })
      }
    },
    scoped_messages: {
      name: 'scoped_messages',
      schema: {
        type: SchemaType.Object,
        properties: {
          id: { type: SchemaType.String },
          account_id: { type: SchemaType.String },
          contact_id: { type: SchemaType.String }
        }
      },
      indexes: {
        id: { name: 'id', type: Index.Primary, columns: ['id'] }
      },
      relations: {
        contact: {
          sourceTable: 'scoped_contacts',
          sourceColumn: 'id',
          sourceIndex: Index.Primary,
          targetColumn: 'contact_id',
          onDelete: 'cascade',
          ...(scope && { scope })
        }
      }
    }
  });

  const scopedKeyError = /violates foreign key constraint "scoped_messages_contact_fk"/;

  const runSteps = async (target: PgTableRepository, source: PgTableRepository) => {
    const steps = getUpdateStepQueries(target, source);

    await runMigration(client, steps.prepare);
    await runMigration(client, steps.rollout);
    await runMigration(client, steps.cleanup);
  };

  beforeEach(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "scoped_messages"`);
    await client.rawQuery(`DROP TABLE IF EXISTS "scoped_contacts"`);
  });

  it('assert :: scoped relation keeps records within their scope', async () => {
    await runMigration(client, getCreateQueries(getRepository(['account_id'])));

    await client.rawQuery(`INSERT INTO "scoped_contacts" VALUES ('contact-a', 'account-a'), ('contact-b', 'account-b')`);
    await client.rawQuery(`INSERT INTO "scoped_messages" VALUES ('message-a', 'account-a', 'contact-a')`);

    // The contact exists, but in another account.
    await rejects(client.rawQuery(`INSERT INTO "scoped_messages" VALUES ('message-b', 'account-a', 'contact-b')`), scopedKeyError);

    await client.rawQuery(`DELETE FROM "scoped_contacts" WHERE "id" = 'contact-a'`);

    deepEqual(await client.rawQuery(`SELECT "id" FROM "scoped_messages"`), []);
  });

  it('assert :: scope an existing relation along with its key', async () => {
    await runMigration(client, getCreateQueries(getRepository()));

    await client.rawQuery(`INSERT INTO "scoped_contacts" VALUES ('contact-a', 'account-a'), ('contact-b', 'account-b')`);
    await client.rawQuery(`INSERT INTO "scoped_messages" VALUES ('message-a', 'account-a', 'contact-a')`);

    await runSteps(getRepository(['account_id']), getRepository());

    await rejects(client.rawQuery(`INSERT INTO "scoped_messages" VALUES ('message-b', 'account-a', 'contact-b')`), scopedKeyError);
  });

  it('assert :: scope an existing relation with records across scopes', async () => {
    await runMigration(client, getCreateQueries(getRepository()));

    await client.rawQuery(`INSERT INTO "scoped_contacts" VALUES ('contact-b', 'account-b')`);
    await client.rawQuery(`INSERT INTO "scoped_messages" VALUES ('message-a', 'account-a', 'contact-b')`);

    await rejects(
      runSteps(getRepository(['account_id']), getRepository()),
      /violates foreign key constraint "scoped_messages_contact_tmp_fk"/
    );

    // The relation keeps its current key.
    await client.rawQuery(`DELETE FROM "scoped_contacts" WHERE "id" = 'contact-b'`);

    deepEqual(await client.rawQuery(`SELECT "id" FROM "scoped_messages"`), []);
  });
});
