import type { PgExecuteOptions, PgExecuteStatement, PostgresEngine } from '@ez4/pgclient';
import type { Database, Client as DbClient } from '@ez4/database';
import type { PgTableRepository } from '@ez4/pgclient/library';
import type { String } from '@ez4/schema';

import { ClientDriver, createPool } from '@ez4/pgclient/driver';
import { getCreateQueries } from '@ez4/pgmigration';
import { PgClient } from '@ez4/pgclient';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { TestConnection } from './data-api';
import { runMigration } from './migration';

export type RecordedStatement = {
  query: string;
  variablesSize: number;
  transactionId?: string;
};

export class RecordingDriver extends ClientDriver {
  statements: RecordedStatement[] = [];

  async executeStatement(statement: PgExecuteStatement, options?: PgExecuteOptions) {
    this.statements.push({
      query: statement.query,
      variablesSize: Buffer.byteLength(JSON.stringify(statement.variables ?? [])),
      transactionId: options?.transactionId
    });

    return super.executeStatement(statement, options);
  }
}

export declare class TestUniqueDb extends Database.Service<PostgresEngine> {
  tables: [
    Database.UseTable<{
      name: 'ez4_test_unique';
      schema: {
        id: String.UUID;
        email: string;
        tenant?: string | null;
        slug?: string | null;
        counter?: number;
        status?: string;
        created_at?: String.DateTime;
        json?: {
          total?: number;
          label?: string;
        } | null;
      };
      indexes: {
        id: Index.Primary;
        email: Index.Unique;
        'tenant:slug': Index.Unique;
      };
    }>
  ];
}

export const makeRecordingClient = <T extends Database.Service<any>>(repository: PgTableRepository, dataApi?: boolean) => {
  // Enough connections for concurrent transactions to race on the same key.
  const pool = createPool({ ...TestConnection, poolSize: 8 });

  const driver = new RecordingDriver(pool, { dataApi });

  const client = PgClient.make<T>({
    repository,
    driver
  });

  return { client, driver };
};

export const makeUniqueClient = (dataApi?: boolean) => {
  return makeRecordingClient<TestUniqueDb>(TestUniqueRepository, dataApi);
};

export const prepareUniqueTable = async (client: DbClient<TestUniqueDb>) => {
  const queries = getCreateQueries(TestUniqueRepository);

  // Unique indexes are created concurrently, which can't run inside a transaction.
  await client.rawQuery(`DROP TABLE IF EXISTS "ez4_test_unique"`);
  await runMigration(client, queries);
};

export const TestUniqueRepository: PgTableRepository = {
  ez4_test_unique: {
    name: 'ez4_test_unique',
    relations: {},
    schema: {
      type: SchemaType.Object,
      properties: {
        id: {
          type: SchemaType.String,
          format: 'uuid'
        },
        email: {
          type: SchemaType.String
        },
        tenant: {
          type: SchemaType.String,
          optional: true,
          nullable: true
        },
        slug: {
          type: SchemaType.String,
          optional: true,
          nullable: true
        },
        counter: {
          type: SchemaType.Number,
          format: 'integer',
          optional: true
        },
        status: {
          type: SchemaType.String,
          optional: true
        },
        created_at: {
          type: SchemaType.String,
          format: 'date-time',
          optional: true
        },
        json: {
          type: SchemaType.Object,
          optional: true,
          nullable: true,
          properties: {
            total: {
              type: SchemaType.Number,
              format: 'integer',
              optional: true
            },
            label: {
              type: SchemaType.String,
              optional: true
            }
          }
        }
      }
    },
    indexes: {
      id: {
        name: 'id',
        columns: ['id'],
        type: Index.Primary
      },
      email: {
        name: 'email',
        columns: ['email'],
        type: Index.Unique
      },
      'tenant:slug': {
        name: 'tenant:slug',
        columns: ['tenant', 'slug'],
        type: Index.Unique
      }
    }
  }
};
