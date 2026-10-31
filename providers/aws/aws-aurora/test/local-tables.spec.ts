import type { PgTableRepository } from '@ez4/pgclient/library';
import type { ServeOptions } from '@ez4/project/library';
import type { ClientConnection } from '@ez4/pgclient';

import { deepEqual } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { Client } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { createAllTables, deleteAllTables } from '../src/local/tables';

const CONNECTION: ClientConnection = {
  database: 'ez4_test_aurora_local_tables',
  password: 'postgres',
  user: 'postgres',
  host: '127.0.0.1',
  port: 5432
};

const getServeOptions = (reset: boolean) => {
  return {
    prefix: 'ez4',
    projectName: 'test',
    branchName: '',
    serviceHost: 'localhost',
    version: 1,
    localOptions: {},
    testOptions: {},
    reset
  } as ServeOptions;
};

describe('aurora local tables', () => {
  const client = Client.make({
    debug: false,
    repository: {},
    connection: CONNECTION
  });

  const columnExists = (table: string, column: string) => {
    return client.rawQuery(
      `SELECT true AS ${column} FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}'`
    );
  };

  const indexExists = (index: string) => {
    return client.rawQuery(`SELECT true AS ${index} FROM pg_class WHERE relkind = 'i' AND relname = '${index}'`);
  };

  const constraintExists = (constraint: string) => {
    return client.rawQuery(`SELECT true AS ${constraint} FROM pg_constraint WHERE convalidated AND conname = '${constraint}'`);
  };

  // The database is only dropped up front: dropping it at the end would end the idle connections of the shared pool,
  // which has no error listener.
  before(async () => {
    await deleteAllTables(CONNECTION);
  });

  it('assert :: new column with an index', async () => {
    const repositoryV1: PgTableRepository = {
      items: {
        name: 'items',
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
      }
    };

    const repositoryV2: PgTableRepository = {
      items: {
        ...repositoryV1.items,
        schema: {
          type: SchemaType.Object,
          properties: {
            ...repositoryV1.items.schema.properties,
            code: {
              type: SchemaType.String,
              optional: true
            }
          }
        },
        indexes: {
          ...repositoryV1.items.indexes,
          code: {
            type: Index.Secondary,
            columns: ['code'],
            name: 'code'
          }
        }
      }
    };

    await createAllTables(CONNECTION, repositoryV1, getServeOptions(true));
    await createAllTables(CONNECTION, repositoryV2, getServeOptions(false));

    const result = await Promise.all([columnExists('items', 'code'), indexExists('items_code_sk')]);

    deepEqual(result, [[{ code: true }], [{ items_code_sk: true }]]);
  });

  it('assert :: new column with a relation', async () => {
    const repositoryV1: PgTableRepository = {
      parents: {
        name: 'parents',
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
      children: {
        name: 'children',
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
      }
    };

    const repositoryV2: PgTableRepository = {
      parents: repositoryV1.parents,
      children: {
        ...repositoryV1.children,
        schema: {
          type: SchemaType.Object,
          properties: {
            ...repositoryV1.children.schema.properties,
            parent_id: {
              type: SchemaType.String,
              format: 'uuid',
              optional: true
            }
          }
        },
        relations: {
          parent: {
            sourceTable: 'parents',
            sourceColumn: 'id',
            sourceIndex: Index.Primary,
            targetColumn: 'parent_id'
          }
        }
      }
    };

    await createAllTables(CONNECTION, repositoryV1, getServeOptions(true));
    await createAllTables(CONNECTION, repositoryV2, getServeOptions(false));

    const result = await Promise.all([columnExists('children', 'parent_id'), constraintExists('children_parent_fk')]);

    deepEqual(result, [[{ parent_id: true }], [{ children_parent_fk: true }]]);
  });

  it('assert :: removed relation along with the unique key it references', async () => {
    const getRepository = (related: boolean): PgTableRepository => ({
      owners: {
        name: 'owners',
        relations: {},
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            email: { type: SchemaType.String }
          }
        },
        indexes: {
          id: { type: Index.Primary, columns: ['id'], name: 'id' },
          ...(related && {
            email: { type: Index.Unique, columns: ['email'], name: 'email' }
          })
        }
      },
      pets: {
        name: 'pets',
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            owner_email: { type: SchemaType.String }
          }
        },
        indexes: {
          id: { type: Index.Primary, columns: ['id'], name: 'id' }
        },
        relations: {
          ...(related && {
            owner: {
              sourceTable: 'owners',
              sourceColumn: 'email',
              sourceIndex: Index.Unique,
              targetColumn: 'owner_email'
            }
          })
        }
      }
    });

    await createAllTables(CONNECTION, getRepository(true), getServeOptions(true));
    await createAllTables(CONNECTION, getRepository(false), getServeOptions(false));

    const result = await Promise.all([constraintExists('pets_owner_fk'), indexExists('owners_email_uk')]);

    deepEqual(result, [[], []]);
  });

  it('assert :: reset table with timestamps', async () => {
    const repository: PgTableRepository = {
      stamped: {
        name: 'stamped',
        relations: {},
        timestamps: {
          created: 'created_at',
          updated: 'updated_at'
        },
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            name: { type: SchemaType.String },
            created_at: { type: SchemaType.String, format: 'date-time' },
            updated_at: { type: SchemaType.String, format: 'date-time' }
          }
        },
        indexes: {
          id: { type: Index.Primary, columns: ['id'], name: 'id' }
        }
      }
    };

    await createAllTables(CONNECTION, repository, getServeOptions(true));

    // A reset builds the table as a new one, through the same statements a deploy creates it with.
    const [objects] = await client.rawQuery(
      `SELECT ` +
        `(SELECT count(*)::int FROM "pg_trigger" WHERE "tgname" = 'ez4_stamp_updated_at' AND "tgrelid" = 'stamped'::regclass) AS "triggers", ` +
        `(SELECT count(*)::int FROM "pg_proc" WHERE "proname" = 'ez4_stamp_updated_at') AS "functions", ` +
        `(SELECT count(*)::int FROM "information_schema"."columns" WHERE "table_name" = 'stamped' ` +
        `AND "column_default" = 'date_trunc(''milliseconds''::text, statement_timestamp())') AS "defaults"`
    );

    deepEqual(objects, { triggers: 1, functions: 1, defaults: 2 });

    await client.rawQuery(`INSERT INTO "stamped" ("id", "name") VALUES ('a', 'foo')`);
    await client.rawQuery(`UPDATE "stamped" SET "updated_at" = '2020-01-01T00:00:00Z' WHERE "id" = 'a'`);

    const [record] = await client.rawQuery(`SELECT "updated_at" > "created_at" - interval '1 second' AS "stamped" FROM "stamped"`);

    deepEqual(record, { stamped: true });
  });
});
