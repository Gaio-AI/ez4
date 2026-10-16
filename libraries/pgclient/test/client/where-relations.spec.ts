import { deleteRelationTables, makeRelationClient, prepareRelationTables } from './common/relation';

import { after, before, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

describe('client where relations', async () => {
  const client = await makeRelationClient();

  const idB1 = randomUUID();
  const idB2 = randomUUID();
  const idB3 = randomUUID();

  const idU = randomUUID();

  before(async () => {
    await prepareRelationTables(client);

    // B1 and B2 each have a child row in table_a and in table_c, B3 has none.
    await client.table_b.insertOne({ data: { id_b: idB1, value: 'B1' } });
    await client.table_b.insertOne({ data: { id_b: idB2, value: 'B2' } });
    await client.table_b.insertOne({ data: { id_b: idB3, value: 'B3' } });

    await client.table_c.insertOne({ data: { id_c: randomUUID(), value: 'C1', unique_2_id: idU, relation: { id_b: idB1 } } });
    await client.table_c.insertOne({ data: { id_c: randomUUID(), value: 'C2', relation: { id_b: idB2 } } });

    // A1 points to B1 and to C1, A2 only to B2, A3 to nothing.
    await client.table_a.insertOne({
      data: { id_a: randomUUID(), value: 'A1', relation_1: { id_b: idB1 }, relation_2: { unique_2_id: idU } }
    });

    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'A2', relation_1: { id_b: idB2 } } });
    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'A3' } });
  });

  after(async () => {
    await deleteRelationTables(client);
  });

  const findTableA = async (where: Parameters<typeof client.table_a.findMany>[0]['where']) => {
    const { records } = await client.table_a.findMany({ select: { value: true }, where });

    return records.map(({ value }) => value).sort();
  };

  const findTableB = async (where: Parameters<typeof client.table_b.findMany>[0]['where']) => {
    const { records } = await client.table_b.findMany({ select: { value: true }, where });

    return records.map(({ value }) => value).sort();
  };

  it('assert :: where secondary to primary relation is null', async () => {
    deepEqual(await findTableA({ relation_1: null }), ['A3']);
  });

  it('assert :: where secondary to primary relation exists', async () => {
    deepEqual(await findTableA({ relation_1: {} }), ['A1', 'A2']);
  });

  it('assert :: where secondary to unique relation is null', async () => {
    deepEqual(await findTableA({ relation_2: null }), ['A2', 'A3']);
  });

  it('assert :: where primary to secondary relation is null', async () => {
    deepEqual(await findTableB({ relations: null }), ['B3']);
  });

  it('assert :: where primary to secondary relation is not null', async () => {
    deepEqual(await findTableB({ NOT: { relations: null } }), ['B1', 'B2']);
  });

  it('assert :: where primary to unique relation is null', async () => {
    deepEqual(await findTableB({ relation: null }), ['B3']);
  });

  it('assert :: where relation is null among other filters', async () => {
    deepEqual(await findTableB({ value: { not: 'B1' }, relations: null, AND: [{ relation: null }] }), ['B3']);
  });

  it('assert :: where relation is null inside or', async () => {
    deepEqual(await findTableB({ OR: [{ relations: null }, { value: 'B1' }] }), ['B1', 'B3']);
  });
});
