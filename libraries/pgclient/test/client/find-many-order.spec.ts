import type { PgExecuteOptions, PgExecuteStatement } from '@ez4/pgclient';
import type { TestSchemaDb } from './common/schema';

import { after, before, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { ClientDriver, createPool } from '@ez4/pgclient/driver';
import { PgClient } from '@ez4/pgclient';
import { Order } from '@ez4/database';

import { prepareSchemaTable, TestSchemaRepository } from './common/schema';
import { TestConnection } from './common/data-api';

type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  'Sort Key'?: string[];
  Plans?: PlanNode[];
};

class RecordingDriver extends ClientDriver {
  statements: PgExecuteStatement[] = [];

  async executeStatement(statement: PgExecuteStatement, options?: PgExecuteOptions) {
    this.statements.push(statement);

    return super.executeStatement(statement, options);
  }
}

describe('client find many order', () => {
  const pool = createPool(TestConnection);

  const driver = new RecordingDriver(pool);

  const client = PgClient.make<TestSchemaDb>({
    repository: TestSchemaRepository,
    driver
  });

  before(async () => {
    await prepareSchemaTable(client);

    await client.rawQuery(`CREATE INDEX "ez4_test_table_datetime_sk" ON "ez4_test_table" ("datetime")`);
    await client.rawQuery(`CREATE INDEX "ez4_test_table_date_sk" ON "ez4_test_table" ("date")`);
    await client.rawQuery(`CREATE INDEX "ez4_test_table_time_sk" ON "ez4_test_table" ("time")`);

    // Rows go in out of order, so the result order comes from the query alone.
    await client.ez4_test_table.insertMany({
      data: Array.from({ length: 20 }).map((_, position) => {
        const index = (position * 7) % 20;

        return {
          id: randomUUID(),
          datetime: `1991-04-${index + 10}T23:59:30.000Z`,
          date: `1991-04-${index + 10}`,
          time: `23:${index + 39}:30.000Z`
        };
      })
    });
  });

  after(async () => {
    await pool.end();
  });

  const explainLastStatement = async () => {
    const { query, variables } = driver.statements[driver.statements.length - 1];

    const transactionId = await driver.beginTransaction();

    try {
      // Without sequential scans the planner reads the order from an index whenever the query lets it.
      await driver.executeStatement({ query: `SET LOCAL enable_seqscan = off` }, { transactionId });

      const { records } = await driver.executeStatement({ query: `EXPLAIN (FORMAT JSON) ${query}`, variables }, { transactionId });

      const [{ Plan }] = records[0]?.['QUERY PLAN'];

      return getPlanNodes(Plan);
    } finally {
      await driver.rollbackTransaction(transactionId);
    }
  };

  const getPlanNodes = (plan: PlanNode): PlanNode[] => {
    return [plan, ...(plan.Plans ?? []).flatMap(getPlanNodes)];
  };

  const getSortKeys = (nodes: PlanNode[]) => {
    return nodes.filter((node) => node['Node Type'] === 'Sort').flatMap((node) => node['Sort Key'] ?? []);
  };

  const getScannedIndexes = (nodes: PlanNode[]) => {
    return nodes
      .filter((node) => node['Node Type'] === 'Index Scan' || node['Node Type'] === 'Index Only Scan')
      .map((node) => node['Index Name']);
  };

  it('assert :: find many ordered by date-time', async () => {
    const { records } = await client.ez4_test_table.findMany({
      take: 3,
      select: {
        datetime: true
      },
      order: {
        datetime: Order.Desc
      }
    });

    deepEqual(records, [
      { datetime: '1991-04-29T23:59:30.000Z' },
      { datetime: '1991-04-28T23:59:30.000Z' },
      { datetime: '1991-04-27T23:59:30.000Z' }
    ]);

    const nodes = await explainLastStatement();

    deepEqual(getSortKeys(nodes), []);
    deepEqual(getScannedIndexes(nodes), ['ez4_test_table_datetime_sk']);
  });

  it('assert :: find many ordered by date', async () => {
    const { records } = await client.ez4_test_table.findMany({
      take: 3,
      select: {
        date: true
      },
      order: {
        date: Order.Desc
      }
    });

    deepEqual(records, [{ date: '1991-04-29' }, { date: '1991-04-28' }, { date: '1991-04-27' }]);

    const nodes = await explainLastStatement();

    deepEqual(getSortKeys(nodes), []);
    deepEqual(getScannedIndexes(nodes), ['ez4_test_table_date_sk']);
  });

  it('assert :: find many ordered by time', async () => {
    const { records } = await client.ez4_test_table.findMany({
      take: 3,
      select: {
        time: true
      },
      order: {
        time: Order.Asc
      }
    });

    deepEqual(records, [{ time: '23:39:30.000Z' }, { time: '23:40:30.000Z' }, { time: '23:41:30.000Z' }]);

    const nodes = await explainLastStatement();

    deepEqual(getSortKeys(nodes), []);
    deepEqual(getScannedIndexes(nodes), ['ez4_test_table_time_sk']);
  });
});
