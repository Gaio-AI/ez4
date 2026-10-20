import type { Client, Database, Index } from '@ez4/database';
import type { Environment, Service } from '@ez4/common';
import type { TestEngine } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngine> {
  client: Client<TestDatabase>;

  tables: [
    Database.UseTable<{
      name: 'tableA';
      indexes: {
        id: Index.Primary;

        // A unique index with options still identifies a record.
        code: {
          type: Index.Unique;
          name: 'table_a_code_key';
          include: ['value'];
        };

        // A partial unique index doesn't.
        alias: {
          type: Index.Unique;
          where: { deleted_at: null };
        };

        // A unique index named apart from its columns.
        external_key: {
          type: Index.Unique;
          columns: ['provider', 'external_id'];
        };

        // A partial secondary index sharing its columns with another index.
        'provider:external_id:active': {
          type: Index.Secondary;
          columns: ['provider', 'external_id'];
          where: { deleted_at: null };
        };
      };
      schema: {
        id: string;
        code: string;
        alias: string;
        provider: string;
        external_id: string;
        value: number;
        deleted_at?: string | null;
      };
    }>
  ];

  services: {
    selfClient: Environment.Service<TestDatabase>;
  };
}

export const testFindOne = async ({ selfClient }: Service.Context<TestDatabase>) => {
  await selfClient.tableA.findOne({
    select: { id: true },
    where: { id: 'foo' }
  });

  await selfClient.tableA.findOne({
    select: { id: true },
    where: { code: 'foo' }
  });

  await selfClient.tableA.findOne({
    select: { id: true },
    where: { provider: 'foo', external_id: 'bar' }
  });

  await selfClient.tableA.findOne({
    select: { id: true },
    // @ts-expect-error A partial unique index doesn't identify a record.
    where: { alias: 'foo' }
  });
};
