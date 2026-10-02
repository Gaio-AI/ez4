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
});
