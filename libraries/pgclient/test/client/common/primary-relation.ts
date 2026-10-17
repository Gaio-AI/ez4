import type { Database, Client as DbClient } from '@ez4/database';
import type { PgTableRepository } from '@ez4/pgclient/library';
import type { PostgresEngine } from '@ez4/pgclient';
import type { String } from '@ez4/schema';

import { getCreateQueries } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { makeRecordingClient } from './unique';
import { runMigration } from './migration';

export declare class TestPrimaryRelationDb extends Database.Service<PostgresEngine> {
  tables: [
    Database.UseTable<{
      name: 'table_account';
      schema: {
        id: String.UUID;
        value: string;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    Database.UseTable<{
      name: 'table_account_stats';
      schema: {
        account_id: String.UUID;
        total: number;
      };
      relations: {
        // Primary to primary
        'account_id@account': 'table_account:id';
      };
      indexes: {
        account_id: Index.Primary;
      };
    }>
  ];
}

export const makePrimaryRelationClient = () => {
  return makeRecordingClient<TestPrimaryRelationDb>(TestPrimaryRelationRepository);
};

export const preparePrimaryRelationTables = async (client: DbClient<TestPrimaryRelationDb>) => {
  const queries = getCreateQueries(TestPrimaryRelationRepository);

  await deletePrimaryRelationTables(client);
  await runMigration(client, queries);
};

export const deletePrimaryRelationTables = async (client: DbClient<TestPrimaryRelationDb>) => {
  await client.rawQuery(`DROP TABLE IF EXISTS "table_account_stats" CASCADE`);
  await client.rawQuery(`DROP TABLE IF EXISTS "table_account" CASCADE`);
};

export const TestPrimaryRelationRepository: PgTableRepository = {
  table_account: {
    name: 'table_account',
    relations: {},
    schema: {
      type: SchemaType.Object,
      properties: {
        id: {
          type: SchemaType.String,
          format: 'uuid'
        },
        value: {
          type: SchemaType.String
        }
      }
    },
    indexes: {
      id: {
        name: 'id',
        columns: ['id'],
        type: Index.Primary
      }
    }
  },
  table_account_stats: {
    name: 'table_account_stats',
    relations: {
      account: {
        sourceColumn: 'id',
        sourceIndex: Index.Primary,
        sourceTable: 'table_account',
        targetColumn: 'account_id',
        targetIndex: Index.Primary
      }
    },
    schema: {
      type: SchemaType.Object,
      properties: {
        account_id: {
          type: SchemaType.String,
          format: 'uuid'
        },
        total: {
          type: SchemaType.Number,
          format: 'integer'
        }
      }
    },
    indexes: {
      account_id: {
        name: 'account_id',
        columns: ['account_id'],
        type: Index.Primary
      }
    }
  }
};
