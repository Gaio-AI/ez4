import type { Client, Database, EventualReadMode, Index } from '@ez4/database';
import type { Environment, Service } from '@ez4/common';
import type { TestEngine, TestEngineEventualRead } from '../common/engines';

declare class TestTable implements Database.Schema {
  id: string;
  value: number;
}

type TestTables = [
  Database.UseTable<{
    name: 'table';
    schema: TestTable;
    indexes: {
      id: Index.Primary;
    };
  }>
];

export declare class EventualDatabase extends Database.Service<TestEngineEventualRead<EventualReadMode.Supported>> {
  client: Client<EventualDatabase>;

  tables: TestTables;

  services: {
    selfClient: Environment.Service<EventualDatabase>;
  };
}

export declare class StrongDatabase extends Database.Service<TestEngine> {
  client: Client<StrongDatabase>;

  tables: TestTables;

  services: {
    selfClient: Environment.Service<StrongDatabase>;
  };
}

export async function testEventualReads({ selfClient }: Service.Context<EventualDatabase>) {
  await selfClient.table.findOne({ select: { id: true }, where: { id: 'abc' }, consistent: false });

  await selfClient.table.findMany({ select: { id: true }, consistent: false });

  await selfClient.table.exists({ where: { id: 'abc' }, consistent: false });
}

export async function testStrongReads({ selfClient }: Service.Context<StrongDatabase>) {
  // @ts-expect-error An engine without eventual reads doesn't take the option.
  await selfClient.table.findOne({ select: { id: true }, where: { id: 'abc' }, consistent: false });

  // @ts-expect-error An engine without eventual reads doesn't take the option.
  await selfClient.table.findMany({ select: { id: true }, consistent: false });

  // @ts-expect-error An engine without eventual reads doesn't take the option.
  await selfClient.table.exists({ where: { id: 'abc' }, consistent: false });
}
