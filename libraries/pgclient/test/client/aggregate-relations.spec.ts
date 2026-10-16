import { deleteRelationTables, makeRelationClient, prepareRelationTables } from './common/relation';

import { after, before, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

describe('client aggregate relations', async () => {
  const client = await makeRelationClient();

  const idB1 = randomUUID();
  const idB2 = randomUUID();

  before(async () => {
    await prepareRelationTables(client);

    await client.table_b.insertOne({ data: { id_b: idB1, value: 'B1' } });
    await client.table_b.insertOne({ data: { id_b: idB2, value: 'B2' } });

    // A1 and A2 point to B1, A3 to B2 and A4 to nothing.
    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'x', relation_1: { id_b: idB1 } } });
    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'y', relation_1: { id_b: idB1 } } });
    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'x', relation_1: { id_b: idB2 } } });
    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'x' } });
  });

  after(async () => {
    await deleteRelationTables(client);
  });

  it('assert :: aggregate where relation exists ordered by alias', async () => {
    const rows = await client.table_a.aggregate({
      by: ['relation_1_id'],
      where: {
        relation_1: {}
      },
      select: {
        total: { count: true }
      },
      order: {
        total: Order.Desc
      }
    });

    deepEqual(rows, [
      { relation_1_id: idB1, total: 2 },
      { relation_1_id: idB2, total: 1 }
    ]);
  });

  it('assert :: aggregate where relation is null', async () => {
    const rows = await client.table_a.aggregate({
      where: {
        relation_1: null
      },
      select: {
        total: { count: true }
      }
    });

    deepEqual(rows, [{ total: 1 }]);
  });

  it('assert :: aggregate where relation field ordered by group column', async () => {
    const rows = await client.table_a.aggregate({
      by: ['value'],
      where: {
        relation_1: {
          value: 'B1'
        }
      },
      select: {
        total: { count: true }
      },
      order: {
        value: Order.Desc
      }
    });

    deepEqual(rows, [
      { value: 'y', total: 1 },
      { value: 'x', total: 1 }
    ]);
  });

  it('assert :: aggregate with relation filter', async () => {
    const rows = await client.table_a.aggregate({
      by: ['value'],
      select: {
        total: { count: true },
        on_b1: { count: true, where: { relation_1: { value: 'B1' } } },
        unlinked: { count: true, where: { relation_1: null } }
      },
      order: {
        value: Order.Asc
      }
    });

    deepEqual(rows, [
      { value: 'x', total: 3, on_b1: 1, unlinked: 1 },
      { value: 'y', total: 1, on_b1: 1, unlinked: 0 }
    ]);
  });
});
