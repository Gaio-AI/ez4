import type { Client, Database, Index } from '@ez4/database';
import type { Environment, Service } from '@ez4/common';
import type { TestEngine } from '../common/engines';

import { assertType } from '@ez4/utils';

export declare class TestDatabase extends Database.Service<TestEngine> {
  client: Client<TestDatabase>;

  tables: [
    Database.UseTable<{
      name: 'tableA';
      indexes: {
        id: Index.Primary;
      };
      schema: {
        id: string;
        value_a: number;
      };
    }>,
    Database.UseTable<{
      name: 'tableB';
      relations: {
        // Primary to primary
        'id_a@relation_a': 'tableA:id';
      };
      indexes: {
        id_a: Index.Primary;
      };
      schema: {
        id_a: string;
        value_b: number;
      };
    }>
  ];

  services: {
    selfClient: Environment.Service<TestDatabase>;
  };
}

export const testSelect = async ({ selfClient }: Service.Context<TestDatabase>) => {
  // Fetch tableB and its tableA connection
  const result = await selfClient.tableB.findMany({
    select: {
      id_a: true,
      value_b: true,
      relation_a: {
        value_a: true
      }
    }
  });

  assertType<{ records: { id_a: string; value_b: number; relation_a: { value_a: number } }[] }, typeof result>(true);
};

export const testInsert = async ({ selfClient }: Service.Context<TestDatabase>) => {
  // Create tableB and connect existing tableA
  await selfClient.tableB.insertOne({
    data: {
      value_b: 1,
      relation_a: {
        id: 'foo'
      }
    }
  });

  // Create tableA, tableB and connect
  await selfClient.tableB.insertOne({
    data: {
      value_b: 1,
      relation_a: {
        id: 'foo',
        value_a: 2
      }
    }
  });

  await selfClient.tableB.insertOne({
    data: {
      // @ts-expect-error The key is written through its relation, as any foreign key the record holds.
      id_a: 'foo',
      value_b: 1
    }
  });

  // Insert many takes the key column alone
  await selfClient.tableB.insertMany({
    data: [
      {
        id_a: 'foo',
        value_b: 1
      }
    ]
  });
};

export const testUpsert = ({ selfClient }: Service.Context<TestDatabase>) => {
  // Insert and connect existing tableA, or update tableB.
  return selfClient.tableB.upsertOne({
    insert: {
      value_b: 1,
      relation_a: {
        id: 'foo'
      }
    },
    update: {
      value_b: 2
    },
    where: {
      id_a: 'foo'
    }
  });
};
