import type { Database, Client as DbClient } from '@ez4/database';
import type { PgTableRepository } from '@ez4/pgclient/library';
import type { PostgresEngine } from '@ez4/pgclient';
import type { String } from '@ez4/schema';

import { getCreateQueries } from '@ez4/pgmigration';
import { Client } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { runMigration } from './migration';

export declare class TestTimestampsDb extends Database.Service<PostgresEngine> {
  tables: [
    Database.UseTable<{
      name: 'ez4_stamped_accounts';
      timestamps: {
        created: 'created_at';
        updated: 'updated_at';
      };
      relations: {
        'profile_id@profile': 'ez4_stamped_profiles:id';
        'id@notes': 'ez4_stamped_notes:account_id';
      };
      schema: {
        id: String.UUID;
        profile_id?: String.UUID | null;
        name: string;
        created_at: String.DateTime;
        updated_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
        profile_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'ez4_stamped_profiles';
      timestamps: {
        created: 'created_at';
        updated: 'updated_at';
      };
      schema: {
        id: String.UUID;
        bio: string;
        created_at: String.DateTime;
        updated_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    Database.UseTable<{
      name: 'ez4_stamped_notes';
      timestamps: {
        created: 'created_at';
      };
      schema: {
        id: String.UUID;
        account_id: String.UUID;
        text: string;
        created_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
        account_id: Index.Secondary;
      };
    }>
  ];
}

export const makeTimestampsClient = async (debug?: boolean) => {
  return Client.make<TestTimestampsDb>({
    repository: TestTimestampsRepository,
    debug,
    connection: {
      database: 'pgclient_tests',
      password: 'postgres',
      user: 'postgres',
      host: '127.0.0.1'
    }
  });
};

export const prepareTimestampsTables = async (client: DbClient<TestTimestampsDb>) => {
  await client.rawQuery(`DROP TABLE IF EXISTS "ez4_stamped_accounts" CASCADE`);
  await client.rawQuery(`DROP TABLE IF EXISTS "ez4_stamped_profiles" CASCADE`);
  await client.rawQuery(`DROP TABLE IF EXISTS "ez4_stamped_notes" CASCADE`);

  await runMigration(client, getCreateQueries(TestTimestampsRepository));
};

const dateTime = {
  type: SchemaType.String,
  format: 'date-time'
} as const;

const uuid = {
  type: SchemaType.String,
  format: 'uuid'
} as const;

export const TestTimestampsRepository: PgTableRepository = {
  ez4_stamped_accounts: {
    name: 'ez4_stamped_accounts',
    timestamps: {
      created: 'created_at',
      updated: 'updated_at'
    },
    relations: {
      profile: {
        sourceTable: 'ez4_stamped_profiles',
        sourceColumn: 'id',
        sourceIndex: Index.Primary,
        targetColumn: 'profile_id',
        targetIndex: Index.Secondary
      },
      notes: {
        sourceTable: 'ez4_stamped_notes',
        sourceColumn: 'account_id',
        sourceIndex: Index.Secondary,
        targetColumn: 'id',
        targetIndex: Index.Primary
      }
    },
    schema: {
      type: SchemaType.Object,
      properties: {
        id: uuid,
        profile_id: {
          ...uuid,
          optional: true,
          nullable: true
        },
        name: {
          type: SchemaType.String
        },
        created_at: dateTime,
        updated_at: dateTime
      }
    },
    indexes: {
      id: {
        name: 'id',
        columns: ['id'],
        type: Index.Primary
      },
      profile_id: {
        name: 'profile_id',
        columns: ['profile_id'],
        type: Index.Secondary
      }
    }
  },
  ez4_stamped_profiles: {
    name: 'ez4_stamped_profiles',
    timestamps: {
      created: 'created_at',
      updated: 'updated_at'
    },
    relations: {},
    schema: {
      type: SchemaType.Object,
      properties: {
        id: uuid,
        bio: {
          type: SchemaType.String
        },
        created_at: dateTime,
        updated_at: dateTime
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
  ez4_stamped_notes: {
    name: 'ez4_stamped_notes',
    timestamps: {
      created: 'created_at'
    },
    relations: {},
    schema: {
      type: SchemaType.Object,
      properties: {
        id: uuid,
        account_id: uuid,
        text: {
          type: SchemaType.String
        },
        created_at: dateTime
      }
    },
    indexes: {
      id: {
        name: 'id',
        columns: ['id'],
        type: Index.Primary
      },
      account_id: {
        name: 'account_id',
        columns: ['account_id'],
        type: Index.Secondary
      }
    }
  }
};
