import type { PgTableRepository } from '@ez4/pgclient/library';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual } from 'assert/strict';

import { Client } from '@ez4/pgclient/driver';
import { getCreateQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { constraintExists, indexExists } from './common/queries';
import { runMigration } from './common/migration';

describe('migration :: client cleanup order tests', async () => {
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

  const runSteps = async (target: PgTableRepository, source: PgTableRepository) => {
    const steps = getUpdateStepQueries(target, source);

    await runMigration(client, steps.prepare, 'prepare');
    await runMigration(client, steps.rollout, 'rollout');
    await runMigration(client, steps.cleanup, 'cleanup');
  };

  beforeEach(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "cleanup_messages"`);
    await client.rawQuery(`DROP TABLE IF EXISTS "cleanup_contacts"`);
  });

  it('assert :: remove a relation along with the unique key it references', async () => {
    const getRepository = (related: boolean): PgTableRepository => ({
      cleanup_contacts: {
        name: 'cleanup_contacts',
        relations: {},
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            email: { type: SchemaType.String }
          }
        },
        indexes: {
          id: { name: 'id', type: Index.Primary, columns: ['id'] },
          ...(related && {
            email: { name: 'email', type: Index.Unique, columns: ['email'] }
          })
        }
      },
      cleanup_messages: {
        name: 'cleanup_messages',
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            contact_email: { type: SchemaType.String }
          }
        },
        indexes: {
          id: { name: 'id', type: Index.Primary, columns: ['id'] }
        },
        relations: {
          ...(related && {
            contact: {
              sourceTable: 'cleanup_contacts',
              sourceColumn: 'email',
              sourceIndex: Index.Unique,
              targetColumn: 'contact_email'
            }
          })
        }
      }
    });

    await runMigration(client, getCreateQueries(getRepository(true)));

    deepEqual(await constraintExists(client, 'cleanup_messages_contact_fk'), [{ cleanup_messages_contact_fk: true }]);

    await runSteps(getRepository(false), getRepository(true));

    deepEqual(await constraintExists(client, 'cleanup_messages_contact_fk'), []);
    deepEqual(await indexExists(client, 'cleanup_contacts_email_uk'), []);
  });

  it('assert :: replace the primary key a relation stops referencing', async () => {
    const getRepository = (primaryKey: string): PgTableRepository => ({
      cleanup_contacts: {
        name: 'cleanup_contacts',
        relations: {},
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            code: { type: SchemaType.String }
          }
        },
        indexes: {
          [primaryKey]: { name: primaryKey, type: Index.Primary, columns: [primaryKey] }
        }
      },
      cleanup_messages: {
        name: 'cleanup_messages',
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            contact_id: { type: SchemaType.String }
          }
        },
        indexes: {
          id: { name: 'id', type: Index.Primary, columns: ['id'] }
        },
        relations: {
          contact: {
            sourceTable: 'cleanup_contacts',
            sourceColumn: 'id',
            targetColumn: 'contact_id',
            ...(primaryKey === 'id' && { sourceIndex: Index.Primary })
          }
        }
      }
    });

    await runMigration(client, getCreateQueries(getRepository('id')));

    deepEqual(await constraintExists(client, 'cleanup_messages_contact_fk'), [{ cleanup_messages_contact_fk: true }]);

    await runSteps(getRepository('code'), getRepository('id'));

    deepEqual(await constraintExists(client, 'cleanup_messages_contact_fk'), []);
    deepEqual(await constraintExists(client, 'cleanup_contacts_code_pk'), [{ cleanup_contacts_code_pk: true }]);
  });
});
