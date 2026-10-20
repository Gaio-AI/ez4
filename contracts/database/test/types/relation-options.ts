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
      relations: {
        // Primary to secondary, with options
        'id@relations_c': {
          source: 'tableC:id_a';
        };
      };
      schema: {
        id: string;
        value_a: number;
      };
    }>,
    Database.UseTable<{
      name: 'tableB';
      relations: {
        // Primary to primary, with a foreign key the indexes alone don't give
        'id_a@relation_a': {
          source: 'tableA:id';
          foreignKey: true;
          onDelete: 'cascade';
        };
      };
      indexes: {
        id_a: Index.Primary;
      };
      schema: {
        id_a: string;
        value_b: number;
      };
    }>,
    Database.UseTable<{
      name: 'tableC';
      relations: {
        // Secondary to primary
        'id_a@relation_a': {
          source: 'tableA:id';
          onDelete: 'restrict';
        };
      };
      indexes: {
        id: Index.Primary;
        id_a: Index.Secondary;
      };
      schema: {
        id: string;
        id_a: string;
        value_c: number;
      };
    }>
  ];

  services: {
    selfClient: Environment.Service<TestDatabase>;
  };
}

export const testSelect = async ({ selfClient }: Service.Context<TestDatabase>) => {
  const resultB = await selfClient.tableB.findMany({
    select: {
      id_a: true,
      value_b: true,
      relation_a: {
        value_a: true
      }
    }
  });

  assertType<{ records: { id_a: string; value_b: number; relation_a: { value_a: number } }[] }, typeof resultB>(true);

  const resultA = await selfClient.tableA.findMany({
    select: {
      id: true,
      relations_c: {
        value_c: true
      }
    }
  });

  assertType<{ records: { id: string; relations_c: { value_c: number }[] }[] }, typeof resultA>(true);
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

  // Create tableC and connect existing tableA
  await selfClient.tableC.insertOne({
    data: {
      id: 'bar',
      value_c: 1,
      relation_a: {
        id: 'foo'
      }
    }
  });
};
