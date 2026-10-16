import { deleteRelationTables, makeRelationClient, prepareRelationTables } from './common/relation';

import { Order } from '@ez4/database';

import { after, before, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

describe('client select relations page', async () => {
  const client = await makeRelationClient();

  const idB = randomUUID();

  // Every related record has the same value, so only the primary key tells them apart.
  const relatedIds = Array.from({ length: 8 }).map(() => randomUUID());

  before(async () => {
    await prepareRelationTables(client);

    await client.table_b.insertOne({
      data: {
        id_b: idB,
        value: 'tableB'
      }
    });

    const sortedIds = relatedIds.toSorted();

    // Rows go in out of the primary key order, so the page order comes from the query alone.
    for (const position of [3, 6, 0, 7, 2, 5, 1, 4]) {
      const idA = sortedIds[position];

      await client.table_a.insertOne({
        data: {
          id_a: idA,
          value: 'same',
          relation_1: {
            id_b: idB
          }
        }
      });
    }
  });

  after(async () => {
    await deleteRelationTables(client);
  });

  it('assert :: select relations page ordered by a repeated value (ascending)', async () => {
    const result = await client.table_b.findOne({
      select: {
        relations: {
          id_a: true
        }
      },
      include: {
        relations: {
          order: {
            value: Order.Asc
          },
          take: 3
        }
      },
      where: {
        id_b: idB
      }
    });

    deepEqual(result, {
      relations: relatedIds
        .toSorted()
        .slice(0, 3)
        .map((id_a) => ({ id_a }))
    });
  });

  it('assert :: select relations page ordered by a repeated value (descending)', async () => {
    const result = await client.table_b.findOne({
      select: {
        relations: {
          id_a: true
        }
      },
      include: {
        relations: {
          order: {
            value: Order.Desc
          },
          skip: 2,
          take: 3
        }
      },
      where: {
        id_b: idB
      }
    });

    deepEqual(result, {
      relations: relatedIds
        .toSorted()
        .reverse()
        .slice(2, 5)
        .map((id_a) => ({ id_a }))
    });
  });
});
