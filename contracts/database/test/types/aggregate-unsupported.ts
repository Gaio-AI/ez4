import type { AggregateMode, Client, Database, Index } from '@ez4/database';
import type { Environment, Service } from '@ez4/common';
import type { TestEngineAggregate } from '../common/engines';

declare class TestTable implements Database.Schema {
  id: string;
  value: number;
}

export declare class TestDatabase extends Database.Service<TestEngineAggregate<AggregateMode.Unsupported>> {
  client: Client<TestDatabase>;

  tables: [
    Database.UseTable<{
      name: 'table';
      schema: TestTable;
      indexes: {
        id: Index.Primary;
      };
    }>
  ];

  services: {
    selfClient: Environment.Service<TestDatabase>;
  };
}

export async function testHandler({ selfClient }: Service.Context<TestDatabase>) {
  // @ts-expect-error The engine has no aggregates.
  selfClient.table.aggregate({
    select: {
      total: { count: true }
    }
  });
}
