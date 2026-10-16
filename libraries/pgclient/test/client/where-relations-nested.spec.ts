import { deleteSelfRelationTables, makeSelfRelationClient, prepareSelfRelationTables } from './common/self-relation';
import { deleteRelationTables, makeRelationClient, prepareRelationTables } from './common/relation';

import { Order } from '@ez4/database';

import { after, before, describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

describe('client where nested relations', async () => {
  const client = await makeRelationClient();

  const idB1 = randomUUID();
  const idB2 = randomUUID();
  const idB3 = randomUUID();

  const idU1 = randomUUID();
  const idU2 = randomUUID();

  before(async () => {
    await prepareRelationTables(client);

    await client.table_b.insertOne({ data: { id_b: idB1, value: 'B1' } });
    await client.table_b.insertOne({ data: { id_b: idB2, value: 'B2' } });
    await client.table_b.insertOne({ data: { id_b: idB3, value: 'B3' } });

    // B1 has C1, B2 has C2, B3 has no C.
    await client.table_c.insertOne({ data: { id_c: randomUUID(), value: 'C1', unique_2_id: idU1, relation: { id_b: idB1 } } });
    await client.table_c.insertOne({ data: { id_c: randomUUID(), value: 'C2', unique_2_id: idU2, relation: { id_b: idB2 } } });

    // A1 and A4 point to B1, A2 to B2, A3 to B3 and A5 to nothing; only A1 points to a C (C1).
    await client.table_a.insertOne({
      data: { id_a: randomUUID(), value: 'A1', relation_1: { id_b: idB1 }, relation_2: { unique_2_id: idU1 } }
    });

    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'A2', relation_1: { id_b: idB2 } } });
    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'A3', relation_1: { id_b: idB3 } } });
    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'A4', relation_1: { id_b: idB1 } } });
    await client.table_a.insertOne({ data: { id_a: randomUUID(), value: 'A5' } });
  });

  after(async () => {
    await deleteRelationTables(client);
  });

  const findTableA = async (where: Parameters<typeof client.table_a.findMany>[0]['where']) => {
    const { records } = await client.table_a.findMany({ select: { value: true }, where });

    return records.map(({ value }) => value).sort();
  };

  it('assert :: where two levels', async () => {
    deepEqual(await findTableA({ relation_1: { relation: { value: 'C1' } } }), ['A1', 'A4']);
  });

  it('assert :: where two levels with fields on each level', async () => {
    deepEqual(await findTableA({ relation_1: { value: 'B2', relation: { value: 'C2' } } }), ['A2']);
    deepEqual(await findTableA({ relation_1: { value: 'B1', relation: { value: 'C2' } } }), []);
  });

  it('assert :: where same column name on every level', async () => {
    deepEqual(await findTableA({ value: 'A4', relation_1: { value: 'B1', relation: { value: 'C1' } } }), ['A4']);
    deepEqual(await findTableA({ value: 'A4', relation_1: { value: 'C1', relation: { value: 'B1' } } }), []);
  });

  it('assert :: where inner relation is null', async () => {
    deepEqual(await findTableA({ relation_1: { relation: null } }), ['A3']);
  });

  it('assert :: where inner relation exists', async () => {
    deepEqual(await findTableA({ relation_1: { relation: {} } }), ['A1', 'A2', 'A4']);
  });

  it('assert :: where not around nested relations', async () => {
    deepEqual(await findTableA({ NOT: { relation_1: { relation: { value: 'C1' } } } }), ['A2', 'A3', 'A5']);
  });

  it('assert :: where or around nested relations', async () => {
    deepEqual(await findTableA({ OR: [{ relation_1: { relation: { value: 'C2' } } }, { value: 'A5' }] }), ['A2', 'A5']);
  });

  it('assert :: where or inside a relation level', async () => {
    deepEqual(await findTableA({ relation_1: { OR: [{ relation: { value: 'C2' } }, { relation: null }] } }), ['A2', 'A3']);
  });

  it('assert :: where not inside a relation level', async () => {
    deepEqual(await findTableA({ relation_1: { NOT: { relation: null } } }), ['A1', 'A2', 'A4']);
  });

  it('assert :: where relation cycle back to the same table', async () => {
    deepEqual(await findTableA({ relation_1: { relations: { value: 'A1' } } }), ['A1', 'A4']);
    deepEqual(await findTableA({ relation_1: { relations: { relation_1: { value: 'B2' } } } }), ['A2']);
  });

  it('assert :: where three levels', async () => {
    deepEqual(await findTableA({ relation_1: { relation: { relations: { value: 'A1' } } } }), ['A1', 'A4']);
  });

  it('assert :: where three levels with the innermost relation null or existing', async () => {
    deepEqual(await findTableA({ relation_1: { relation: { relations: null } } }), ['A2']);
    deepEqual(await findTableA({ relation_1: { relation: { relations: {} } } }), ['A1', 'A4']);
  });

  it('assert :: count with nested relations', async () => {
    equal(await client.table_a.count({ where: { relation_1: { relation: { value: 'C1' } } } }), 2);
  });

  it('assert :: include where with relation filters', async () => {
    const { records } = await client.table_b.findMany({
      select: {
        value: true,
        relations: {
          value: true
        }
      },
      include: {
        relations: {
          where: {
            relation_2: {
              value: 'C1'
            }
          }
        }
      },
      order: {
        value: Order.Asc
      }
    });

    deepEqual(records, [
      { value: 'B1', relations: [{ value: 'A1' }] },
      { value: 'B2', relations: [] },
      { value: 'B3', relations: [] }
    ]);
  });

  it('assert :: include where with nested and null relation filters', async () => {
    const { records } = await client.table_b.findMany({
      select: {
        value: true,
        relations: {
          value: true
        }
      },
      include: {
        relations: {
          where: {
            OR: [{ relation_2: { relation: { value: 'B1' } } }, { relation_2: null, value: 'A3' }]
          },
          order: {
            value: Order.Asc
          },
          take: 5
        }
      },
      order: {
        value: Order.Asc
      }
    });

    deepEqual(records, [
      { value: 'B1', relations: [{ value: 'A1' }] },
      { value: 'B2', relations: [] },
      { value: 'B3', relations: [{ value: 'A3' }] }
    ]);
  });

  // The writes run last, since they change the rows the reads above expect.
  it('assert :: update many with nested relations', async () => {
    await client.table_a.updateMany({ data: { value: 'A2*' }, where: { relation_1: { relation: { value: 'C2' } } } });

    deepEqual(await findTableA({ relation_1: { value: 'B2' } }), ['A2*']);
  });

  it('assert :: delete many with nested relations', async () => {
    await client.table_a.deleteMany({ where: { relation_1: { relation: null } } });

    deepEqual(await findTableA(undefined), ['A1', 'A2*', 'A4', 'A5']);
  });
});

describe('client where nested self relations', async () => {
  const client = await makeSelfRelationClient();

  const idRoot = randomUUID();
  const idX = randomUUID();

  before(async () => {
    await prepareSelfRelationTables(client);

    // root → x → g and root → y
    await client.table_self.insertOne({ data: { id: idRoot, value: 'root' } });
    await client.table_self.insertOne({ data: { id: idX, value: 'x', parent: { id: idRoot } } });
    await client.table_self.insertOne({ data: { id: randomUUID(), value: 'y', parent: { id: idRoot } } });
    await client.table_self.insertOne({ data: { id: randomUUID(), value: 'g', parent: { id: idX } } });
  });

  after(async () => {
    await deleteSelfRelationTables(client);
  });

  const findSelf = async (where: Parameters<typeof client.table_self.findMany>[0]['where']) => {
    const { records } = await client.table_self.findMany({ select: { value: true }, where });

    return records.map(({ value }) => value).sort();
  };

  it('assert :: where grandparent', async () => {
    deepEqual(await findSelf({ parent: { parent: { value: 'root' } } }), ['g']);
  });

  it('assert :: where grandchild', async () => {
    deepEqual(await findSelf({ children: { children: { value: 'g' } } }), ['root']);
  });

  it('assert :: where sibling', async () => {
    deepEqual(await findSelf({ parent: { children: { value: 'y' } } }), ['x', 'y']);
  });

  it('assert :: where some child has no children', async () => {
    deepEqual(await findSelf({ children: { children: null } }), ['root', 'x']);
  });

  it('assert :: where every level filters the same column', async () => {
    deepEqual(await findSelf({ value: 'g', parent: { value: 'x', parent: { value: 'root', parent: null } } }), ['g']);
    deepEqual(await findSelf({ value: 'g', parent: { value: 'root', parent: { value: 'x' } } }), []);
  });
});
