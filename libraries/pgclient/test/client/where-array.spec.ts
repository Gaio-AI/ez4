import type { TestContext } from 'node:test';

import { makeSchemaClient, prepareSchemaTable } from './common/schema';

import { before, describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';
import { Client as PgConnection } from 'pg';

const spyStatements = (t: TestContext) => {
  const query = t.mock.method(PgConnection.prototype, 'query');

  return () => {
    return query.mock.calls.flatMap(({ arguments: [config] }) => {
      const text = typeof config === 'string' ? config : (config as { text?: string })?.text;

      return text?.includes('"ez4_test_table"') ? [text] : [];
    });
  };
};

describe('client where array variable', async () => {
  const client = await makeSchemaClient();
  const dataApiClient = await makeSchemaClient(false, true);

  const fooId = randomUUID();
  const barId = randomUUID();

  before(async () => {
    await prepareSchemaTable(client);

    await client.ez4_test_table.insertMany({
      data: [
        {
          id: fooId,
          integer: 1,
          string: 'foo',
          datetime: '1991-04-23T00:00:00Z',
          json: {
            string: 'foo'
          }
        },
        {
          id: barId,
          integer: 2,
          string: 'bar',
          datetime: '2024-07-01T23:59:59Z',
          json: {
            string: 'bar'
          }
        }
      ]
    });
  });

  it('assert :: where is in uuid (one array variable)', async (t) => {
    const statements = spyStatements(t);

    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        id: {
          isIn: [fooId, randomUUID()]
        }
      }
    });

    deepEqual(records, [{ string: 'foo' }]);

    const [statement] = statements();

    ok(statement.includes('"id" = ANY($1::uuid[])'), statement);
  });

  it('assert :: where is in integer and string', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        id: true
      },
      where: {
        integer: {
          isIn: [2, 3]
        },
        string: {
          isIn: ['bar', 'baz']
        }
      }
    });

    deepEqual(records, [{ id: barId }]);
  });

  it('assert :: where is in datetime', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        datetime: {
          isIn: ['1991-04-23T00:00:00Z', '2000-01-01T00:00:00Z']
        }
      }
    });

    deepEqual(records, [{ string: 'foo' }]);
  });

  it('assert :: where is in json property', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        id: true
      },
      where: {
        json: {
          string: {
            isIn: ['bar', 'qux']
          }
        }
      }
    });

    deepEqual(records, [{ id: barId }]);
  });

  it('assert :: where is in (statement size is the same for any list)', async (t) => {
    const statements = spyStatements(t);

    const ids = Array.from({ length: 3000 }, () => randomUUID());

    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        id: {
          isIn: [...ids, barId]
        }
      }
    });

    deepEqual(records, [{ string: 'bar' }]);

    const [statement] = statements();

    ok(statement.length < 1000, `${statement.length} characters`);
  });

  it('assert :: where is in (data api emulation binds each value)', async (t) => {
    const statements = spyStatements(t);

    const { records } = await dataApiClient.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        id: {
          isIn: [fooId, barId]
        }
      },
      order: {
        integer: Order.Asc
      }
    });

    deepEqual(records, [{ string: 'foo' }, { string: 'bar' }]);

    const [statement] = statements();

    ok(statement.includes('"id" IN ($1::uuid, $2::uuid)'), statement);
  });

  it('assert :: raw query array variable', async () => {
    const values = ['a,b', 'c"d', '{e}', 'f\\g', 'NULL'];

    const result = await client.rawQuery(
      `SELECT value FROM unnest(:values::text[]) WITH ORDINALITY AS list(value, position) ORDER BY position`,
      {
        values
      }
    );

    deepEqual(
      result.map(({ value }) => value),
      values
    );
  });

  it('assert :: raw query array variable (uuid list)', async () => {
    const result = await client.rawQuery(`SELECT string FROM "ez4_test_table" WHERE id = ANY(:ids::uuid[]) ORDER BY integer`, {
      ids: [fooId, barId, randomUUID()]
    });

    deepEqual(result, [{ string: 'foo' }, { string: 'bar' }]);
  });

  it('assert :: raw query array variable (empty list)', async () => {
    const result = await client.rawQuery(`SELECT cardinality(:ids::uuid[]) AS total`, {
      ids: []
    });

    equal(Number(result[0]?.total), 0);
  });

  it('assert :: raw query json variable is unchanged', async () => {
    const result = await client.rawQuery(`SELECT jsonb_array_length(:ids::jsonb) AS total, :ids::jsonb->>0 AS first`, {
      ids: [fooId, barId]
    });

    deepEqual(result, [{ total: 2, first: fooId }]);
  });
});
