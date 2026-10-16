import type { AggregateMode, Client, Database, Index } from '@ez4/database';
import type { Environment, Service } from '@ez4/common';
import type { String } from '@ez4/schema';
import type { TestEngineAggregate } from '../common/engines';

import { Order } from '@ez4/database';
import { assertType } from '@ez4/utils';

declare class TestTable implements Database.Schema {
  id: string;
  folder_id?: string | null;
  status: 'live' | 'draft';
  amount: number;
  ratio?: number | null;
  active: boolean;
  created_at: String.DateTime;
  next_id?: string;
}

export declare class TestDatabase extends Database.Service<TestEngineAggregate<AggregateMode.Supported>> {
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
  // Grouped aggregates.
  const grouped = await selfClient.table.aggregate({
    by: ['folder_id', 'status'],
    where: {
      active: true,
      next: {
        status: 'live'
      }
    },
    select: {
      total: { count: true },
      with_ratio: { count: 'ratio' },
      folders: { count: 'folder_id', distinct: true },
      amount: { sum: 'amount' },
      first: { min: 'created_at' },
      last: { max: 'created_at' },
      highest: { max: 'amount' },
      live: { count: true, where: { status: 'live' } }
    },
    order: {
      total: Order.Desc,
      status: Order.Asc
    },
    skip: 0,
    take: 20
  });

  assertType<
    {
      folder_id: string | null;
      status: 'live' | 'draft';
      total: number;
      with_ratio: number;
      folders: number;
      amount: number | null;
      first: string | null;
      last: string | null;
      highest: number | null;
      live: number;
    }[],
    typeof grouped
  >(true);

  // Aggregates without group.
  const single = await selfClient.table.aggregate({
    select: {
      total: { count: true }
    }
  });

  assertType<{ total: number }[], typeof single>(true);

  // Group columns only.
  const groups = await selfClient.table.aggregate({
    by: ['status'],
    select: {}
  });

  assertType<{ status: 'live' | 'draft' }[], typeof groups>(true);

  selfClient.table.aggregate({
    // @ts-expect-error A group column can't take the name of an alias.
    by: ['status'],
    select: {
      status: { count: true }
    }
  });

  // An alias can take the name of a column out of the group.
  const amounts = await selfClient.table.aggregate({
    by: ['status'],
    select: {
      total: { count: true },
      amount: { sum: 'amount' },
      created_at: { max: 'created_at' }
    }
  });

  assertType<{ status: 'live' | 'draft'; total: number; amount: number | null; created_at: string | null }[], typeof amounts>(true);

  selfClient.table.aggregate({
    select: {
      // @ts-expect-error Only number columns have a sum.
      total: { sum: 'status' }
    }
  });

  selfClient.table.aggregate({
    select: {
      // @ts-expect-error Boolean columns have no lowest value.
      lowest: { min: 'active' }
    }
  });

  selfClient.table.aggregate({
    select: {
      // @ts-expect-error One aggregate per alias.
      total: { count: true, sum: 'amount' }
    }
  });

  selfClient.table.aggregate({
    select: {
      // @ts-expect-error Counting records has no distinct values.
      total: { count: true, distinct: true }
    }
  });

  selfClient.table.aggregate({
    // @ts-expect-error Group by table columns only.
    by: ['next'],
    select: {
      total: { count: true }
    }
  });

  selfClient.table.aggregate({
    by: ['status'],
    select: {
      total: { count: true }
    },
    order: {
      // @ts-expect-error Order by group columns and aliases only.
      amount: Order.Asc
    }
  });
}
