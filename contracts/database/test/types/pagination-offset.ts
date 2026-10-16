import type { Client, Database, PaginationMode, Index } from '@ez4/database';
import type { Environment, Service } from '@ez4/common';
import type { TestEnginePagination } from '../common/engines';

import { assertType } from '@ez4/utils';

declare class TestTable implements Database.Schema {
  id: string;
  next_id: string;
  value: number;
}

export declare class TestDatabase extends Database.Service<TestEnginePagination<PaginationMode.Offset>> {
  client: Client<TestDatabase>;

  tables: [
    Database.UseTable<{
      name: 'table';
      schema: TestTable;
      relations: {
        'next_id@next': 'table:id';
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

export async function testHandler({ selfClient }: Service.Context<TestDatabase>) {
  // Paginate using offset.
  const resultA = await selfClient.table.findMany({
    select: {
      id: true,
      value: true
    },
    skip: 5,
    take: 5
  });

  assertType<string | undefined, typeof resultA.cursor>(true);

  // Paginate using cursor.
  const resultB = await selfClient.table.findMany({
    select: {
      id: true,
      value: true
    },
    cursor: resultA.cursor,
    take: 5
  });

  assertType<string | undefined, typeof resultB.cursor>(true);

  // Paginate using offset in the sub-query.
  selfClient.table.findMany({
    select: {
      id: true,
      value: true,
      next: true
    },
    include: {
      next: {
        skip: 5,
        take: 5
      }
    }
  });

  // No cursor in the sub-query.
  selfClient.table.findMany({
    select: {
      id: true,
      value: true,
      next: true
    },
    include: {
      next: {
        // @ts-expect-error Cursor isn't supported in the sub-query.
        cursor: 'foo-bar',
        take: 5
      }
    }
  });
}
