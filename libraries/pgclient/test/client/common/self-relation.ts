import type { Database, Client as DbClient } from '@ez4/database';
import type { PgTableRepository } from '@ez4/pgclient/library';
import type { PostgresEngine } from '@ez4/pgclient';
import type { String } from '@ez4/schema';

import { getCreateQueries } from '@ez4/pgmigration';
import { Client } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { runMigration } from './migration';

export declare class TestSelfRelationDb extends Database.Service<PostgresEngine> {
  tables: [
    Database.UseTable<{
      name: 'table_self';
      schema: {
        id: String.UUID;
        parent_id?: String.UUID | null;
        value: string;
      };
      relations: {
        // Secondary to primary
        'parent_id@parent': 'table_self:id';

        // Primary to secondary
        'id@children': 'table_self:parent_id';
      };
      indexes: {
        id: Index.Primary;
        parent_id: Index.Secondary;
      };
    }>
  ];
}

export const makeSelfRelationClient = async (debug?: boolean) => {
  return Client.make<TestSelfRelationDb>({
    repository: TestSelfRelationRepository,
    debug,
    connection: {
      database: 'postgres',
      password: 'postgres',
      user: 'postgres',
      host: '127.0.0.1'
    }
  });
};

export const prepareSelfRelationTables = async (client: DbClient<TestSelfRelationDb>) => {
  const queries = getCreateQueries(TestSelfRelationRepository);

  await deleteSelfRelationTables(client);
  await runMigration(client, queries);
};

export const deleteSelfRelationTables = async (client: DbClient<TestSelfRelationDb>) => {
  await client.rawQuery(`DROP TABLE IF EXISTS "table_self" CASCADE`);
};

export const TestSelfRelationRepository: PgTableRepository = {
  table_self: {
    name: 'table_self',
    relations: {
      parent: {
        sourceColumn: 'id',
        sourceIndex: Index.Primary,
        sourceTable: 'table_self',
        targetColumn: 'parent_id',
        targetIndex: Index.Secondary
      },
      children: {
        sourceColumn: 'parent_id',
        sourceIndex: Index.Secondary,
        sourceTable: 'table_self',
        targetColumn: 'id',
        targetIndex: Index.Primary
      }
    },
    schema: {
      type: SchemaType.Object,
      properties: {
        id: {
          type: SchemaType.String,
          format: 'uuid'
        },
        parent_id: {
          type: SchemaType.String,
          format: 'uuid',
          optional: true,
          nullable: true
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
      },
      parent_id: {
        name: 'parent_id',
        columns: ['parent_id'],
        type: Index.Secondary
      }
    }
  }
};
