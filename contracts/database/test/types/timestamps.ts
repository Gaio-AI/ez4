import type { Client, Database, Index, TimestampsMode } from '@ez4/database';
import type { Environment, Service } from '@ez4/common';
import type { String } from '@ez4/schema';
import type { TestEngineTimestamps } from '../common/engines';

import { assertType } from '@ez4/utils';

export declare class TestDatabase extends Database.Service<TestEngineTimestamps<TimestampsMode.Supported>> {
  client: Client<TestDatabase>;

  tables: [
    Database.UseTable<{
      name: 'accounts';
      timestamps: {
        created: 'created_at';
        updated: 'updated_at';
      };
      relations: {
        'id@contacts': 'contacts:account_id';
        'profile_id@profile': 'profiles:id';
      };
      schema: {
        id: string;
        profile_id?: string | null;
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
      name: 'contacts';
      timestamps: {
        created: 'created_at';
      };
      schema: {
        id: string;
        account_id: string;
        email: string;
        created_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
        account_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'profiles';
      timestamps: {
        updated: 'updated_at';
      };
      schema: {
        id: string;
        bio: string;
        updated_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    Database.UseTable<{
      name: 'notes';
      schema: {
        id: string;
        text: string;
        written_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
      };
    }>
  ];

  services: {
    selfClient: Environment.Service<TestDatabase>;
  };
}

export const testInsert = async ({ selfClient }: Service.Context<TestDatabase>) => {
  // The database writes the timestamps left out.
  const result = await selfClient.accounts.insertOne({
    select: {
      created_at: true,
      updated_at: true
    },
    data: {
      id: 'abc',
      name: 'foo'
    }
  });

  assertType<{ created_at: string; updated_at: string }, typeof result>(true);

  // A value given still goes in.
  await selfClient.accounts.insertOne({
    data: {
      id: 'abc',
      name: 'foo',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }
  });

  await selfClient.accounts.insertMany({
    data: [
      { id: 'abc', name: 'foo' },
      { id: 'def', name: 'bar', created_at: '2026-01-01T00:00:00.000Z' }
    ]
  });

  // A table without timestamps still takes all of its columns.
  await selfClient.notes.insertOne({
    // @ts-expect-error The table writes no timestamp of its own.
    data: {
      id: 'abc',
      text: 'foo'
    }
  });
};

export const testUpdate = async ({ selfClient }: Service.Context<TestDatabase>) => {
  await selfClient.accounts.updateOne({
    data: {
      name: 'foo'
    },
    where: {
      id: 'abc'
    }
  });

  await selfClient.accounts.updateOne({
    data: {
      name: 'foo',
      // @ts-expect-error The database writes the update timestamp.
      updated_at: '2026-01-01T00:00:00.000Z'
    },
    where: {
      id: 'abc'
    }
  });

  await selfClient.accounts.updateMany({
    data: {
      // @ts-expect-error The creation timestamp never changes.
      created_at: '2026-01-01T00:00:00.000Z'
    }
  });

  await selfClient.notes.updateOne({
    data: {
      written_at: '2026-01-01T00:00:00.000Z'
    },
    where: {
      id: 'abc'
    }
  });
};

export const testUpsert = async ({ selfClient }: Service.Context<TestDatabase>) => {
  await selfClient.accounts.upsertOne({
    insert: {
      id: 'abc',
      name: 'foo'
    },
    update: {
      name: 'foo'
    },
    where: {
      id: 'abc'
    }
  });

  await selfClient.accounts.upsertOne({
    insert: {
      id: 'abc',
      name: 'foo'
    },
    update: {
      // @ts-expect-error The database writes the update timestamp.
      updated_at: '2026-01-01T00:00:00.000Z'
    },
    where: {
      id: 'abc'
    }
  });
};

export const testRelations = async ({ selfClient }: Service.Context<TestDatabase>) => {
  // The related records get their timestamps from the database too.
  await selfClient.accounts.insertOne({
    data: {
      id: 'abc',
      name: 'foo',
      profile: {
        id: 'def',
        bio: 'bar'
      },
      contacts: [
        {
          id: 'ghi',
          email: 'foo@bar.baz'
        }
      ]
    }
  });

  await selfClient.accounts.updateOne({
    data: {
      profile: {
        bio: 'baz'
      }
    },
    where: {
      id: 'abc'
    }
  });

  await selfClient.accounts.updateOne({
    data: {
      profile: {
        bio: 'baz',
        // @ts-expect-error The database writes the update timestamp of the related record.
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    },
    where: {
      id: 'abc'
    }
  });
};

export const testTouch = async ({ selfClient }: Service.Context<TestDatabase>) => {
  // Writes the record with nothing else to change, bumping its update timestamp.
  await selfClient.accounts.updateOne({
    touch: true,
    data: {},
    where: {
      id: 'abc'
    }
  });

  await selfClient.accounts.updateMany({
    touch: true,
    data: {
      name: 'foo'
    }
  });

  await selfClient.contacts.updateOne({
    // @ts-expect-error A table without an update timestamp has nothing to touch.
    touch: true,
    data: {},
    where: {
      id: 'abc'
    }
  });

  await selfClient.notes.updateMany({
    // @ts-expect-error A table without timestamps has nothing to touch.
    touch: true,
    data: {}
  });
};

export const testTransaction = async ({ selfClient }: Service.Context<TestDatabase>) => {
  await selfClient.transaction({
    accounts: [
      {
        insert: {
          data: {
            id: 'abc',
            name: 'foo'
          }
        }
      },
      {
        update: {
          touch: true,
          data: {},
          where: {
            id: 'abc'
          }
        }
      }
    ]
  });
};
