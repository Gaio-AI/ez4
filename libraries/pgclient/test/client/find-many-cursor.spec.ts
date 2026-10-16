import type { Database, Client as DbClient } from '@ez4/database';
import type { PgTableRepository } from '@ez4/pgclient/library';
import type { PostgresEngine } from '@ez4/pgclient';
import type { String } from '@ez4/schema';

import { after, before, describe, it } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { InvalidCursorError, PgClient, UnsupportedCursorError } from '@ez4/pgclient';
import { ClientDriver, createPool } from '@ez4/pgclient/driver';
import { Index, Order } from '@ez4/database';
import { SchemaType } from '@ez4/schema';

import { TestConnection } from './common/data-api';

type TestCursorSchema = {
  id: String.UUID;
  category: number;
  created_at: String.DateTime;
  label?: string | null;
};

declare class TestCursorDb extends Database.Service<PostgresEngine> {
  tables: [
    Database.UseTable<{
      name: 'ez4_test_cursor';
      schema: TestCursorSchema;
      indexes: {
        id: Index.Primary;
      };
    }>,
    Database.UseTable<{
      name: 'ez4_test_cursor_heap';
      schema: TestCursorSchema;
      indexes: {};
    }>
  ];
}

const TestCursorSchema = {
  type: SchemaType.Object,
  properties: {
    id: {
      type: SchemaType.String,
      format: 'uuid'
    },
    category: {
      type: SchemaType.Number,
      format: 'integer'
    },
    created_at: {
      type: SchemaType.String,
      format: 'date-time'
    },
    label: {
      type: SchemaType.String,
      optional: true,
      nullable: true
    }
  }
} as const;

const TestCursorRepository: PgTableRepository = {
  ez4_test_cursor: {
    name: 'ez4_test_cursor',
    schema: TestCursorSchema,
    relations: {},
    indexes: {
      id: {
        name: 'id',
        columns: ['id'],
        type: Index.Primary
      }
    }
  },
  ez4_test_cursor_heap: {
    name: 'ez4_test_cursor_heap',
    schema: TestCursorSchema,
    relations: {},
    indexes: {}
  }
};

const PAGE_SIZE = 7;

// Each group of five rows shares a millisecond: three rows at the same instant and two more microseconds apart.
const MICROSECONDS = ['123000', '123000', '123000', '123456', '123789'];

const TOTAL_ROWS = 64;

describe('client find many cursor', () => {
  const pool = createPool(TestConnection);

  const client: DbClient<TestCursorDb> = PgClient.make<TestCursorDb>({
    repository: TestCursorRepository,
    driver: new ClientDriver(pool)
  });

  const dataApiClient: DbClient<TestCursorDb> = PgClient.make<TestCursorDb>({
    repository: TestCursorRepository,
    driver: new ClientDriver(pool, {
      dataApi: true
    })
  });

  before(async () => {
    await client.rawQuery(`DROP TABLE IF EXISTS "ez4_test_cursor"`);
    await client.rawQuery(`DROP TABLE IF EXISTS "ez4_test_cursor_heap"`);

    await client.rawQuery(
      `CREATE TABLE "ez4_test_cursor" (` +
        `"id" uuid PRIMARY KEY, "category" bigint NOT NULL, "created_at" timestamptz NOT NULL, "label" text` +
        `)`
    );

    await client.rawQuery(`CREATE TABLE "ez4_test_cursor_heap" (LIKE "ez4_test_cursor")`);

    const rows = Array.from({ length: TOTAL_ROWS }).map((_, index) => {
      const second = Math.floor(index / MICROSECONDS.length)
        .toString()
        .padStart(2, '0');
      const fraction = MICROSECONDS[index % MICROSECONDS.length];

      return `('${randomUUID()}', ${index % 3}, '2024-01-01T00:00:${second}.${fraction}Z'::timestamptz, 'label-${index % 2}')`;
    });

    await client.rawQuery(`INSERT INTO "ez4_test_cursor" ("id", "category", "created_at", "label") VALUES ${rows.join(', ')}`);
    await client.rawQuery(`INSERT INTO "ez4_test_cursor_heap" SELECT * FROM "ez4_test_cursor"`);
  });

  after(async () => {
    await pool.end();
  });

  const readOrderedIds = async (orderBy: string, where = 'TRUE') => {
    const records = await client.rawQuery(`SELECT "id" FROM "ez4_test_cursor" WHERE ${where} ORDER BY ${orderBy}`);

    return records.map((record) => record?.id as string);
  };

  const readCursorPages = async (
    input: Pick<Parameters<DbClient<TestCursorDb>['ez4_test_cursor']['findMany']>[0], 'order' | 'where'>,
    pageClient = client
  ) => {
    const pages: string[][] = [];

    let cursor: string | undefined;

    do {
      const result = await pageClient.ez4_test_cursor.findMany({
        ...input,
        select: {
          id: true
        },
        take: PAGE_SIZE,
        cursor
      });

      pages.push(result.records.map(({ id }) => id));

      cursor = result.cursor;
    } while (cursor && pages.length <= TOTAL_ROWS);

    return pages;
  };

  const getFirstCursor = async () => {
    const { cursor } = await client.ez4_test_cursor.findMany({
      select: {
        id: true
      },
      order: {
        created_at: Order.Desc
      },
      take: PAGE_SIZE
    });

    return cursor!;
  };

  // The last page has no cursor, even when it is full, so no empty page follows it.
  const getPageSizes = (total: number) => {
    return Array.from({ length: Math.ceil(total / PAGE_SIZE) }).map((_, page) => {
      return Math.min(PAGE_SIZE, total - page * PAGE_SIZE);
    });
  };

  it('assert :: find many pages with cursor (descending)', async () => {
    const pages = await readCursorPages({
      order: {
        created_at: Order.Desc
      }
    });

    const expected = await readOrderedIds(`"created_at" DESC, "id" DESC`);

    deepEqual(pages.flat(), expected);
    deepEqual(
      pages.map((page) => page.length),
      getPageSizes(TOTAL_ROWS)
    );
  });

  it('assert :: find many pages with cursor (ascending)', async () => {
    const pages = await readCursorPages({
      order: {
        created_at: Order.Asc
      }
    });

    const expected = await readOrderedIds(`"created_at" ASC, "id" ASC`);

    deepEqual(pages.flat(), expected);
    deepEqual(
      pages.map((page) => page.length),
      getPageSizes(TOTAL_ROWS)
    );
  });

  it('assert :: find many pages with cursor (mixed directions)', async () => {
    const pages = await readCursorPages({
      order: {
        category: Order.Asc,
        created_at: Order.Desc
      }
    });

    const expected = await readOrderedIds(`"category" ASC, "created_at" DESC, "id" DESC`);

    deepEqual(pages.flat(), expected);
    deepEqual(
      pages.map((page) => page.length),
      getPageSizes(TOTAL_ROWS)
    );
  });

  it('assert :: find many pages with cursor (mixed directions after leading columns)', async () => {
    const pages = await readCursorPages({
      order: {
        category: Order.Asc,
        created_at: Order.Asc,
        id: Order.Desc
      }
    });

    const expected = await readOrderedIds(`"category" ASC, "created_at" ASC, "id" DESC`);

    deepEqual(pages.flat(), expected);
    deepEqual(
      pages.map((page) => page.length),
      getPageSizes(TOTAL_ROWS)
    );
  });

  it('assert :: find many pages with cursor (mixed directions, data api)', async () => {
    const pages = await readCursorPages(
      {
        order: {
          category: Order.Desc,
          created_at: Order.Asc
        }
      },
      dataApiClient
    );

    const expected = await readOrderedIds(`"category" DESC, "created_at" ASC, "id" ASC`);

    deepEqual(pages.flat(), expected);
    deepEqual(
      pages.map((page) => page.length),
      getPageSizes(TOTAL_ROWS)
    );
  });

  it('assert :: find many pages with cursor (with filter)', async () => {
    const pages = await readCursorPages({
      where: {
        category: 1
      },
      order: {
        created_at: Order.Desc
      }
    });

    const expected = await readOrderedIds(`"created_at" DESC, "id" DESC`, `"category" = 1`);

    deepEqual(pages.flat(), expected);
    deepEqual(
      pages.map((page) => page.length),
      getPageSizes(expected.length)
    );
  });

  it('assert :: find many last full page without cursor', async () => {
    const expected = await readOrderedIds(`"created_at" DESC, "id" DESC`, `"category" = 1`);

    // The filter matches an exact multiple of the page size.
    equal(expected.length, PAGE_SIZE * 3);

    const results = [];

    let cursor: string | undefined;

    for (let page = 0; page < 3; page++) {
      const result = await client.ez4_test_cursor.findMany({
        select: {
          id: true
        },
        where: {
          category: 1
        },
        order: {
          created_at: Order.Desc
        },
        take: PAGE_SIZE,
        cursor
      });

      results.push(result);

      cursor = result.cursor;
    }

    deepEqual(
      results.map(({ records }) => records.length),
      [PAGE_SIZE, PAGE_SIZE, PAGE_SIZE]
    );

    deepEqual(
      results.map(({ cursor }) => typeof cursor),
      ['string', 'string', 'undefined']
    );

    deepEqual(
      results.flatMap(({ records }) => records.map(({ id }) => id)),
      expected
    );
  });

  it('assert :: find many pages with skip and take', async () => {
    const pages: string[][] = [];

    for (let skip = 0; skip < TOTAL_ROWS; skip += PAGE_SIZE) {
      const { records } = await client.ez4_test_cursor.findMany({
        select: {
          id: true
        },
        order: {
          created_at: Order.Desc
        },
        take: PAGE_SIZE,
        skip
      });

      pages.push(records.map(({ id }) => id));
    }

    const expected = await readOrderedIds(`"created_at" DESC, "id" DESC`);

    deepEqual(pages.flat(), expected);
  });

  it('assert :: find many with cursor and skip', async () => {
    const cursor = await getFirstCursor();

    const { records } = await client.ez4_test_cursor.findMany({
      select: {
        id: true
      },
      order: {
        created_at: Order.Desc
      },
      take: PAGE_SIZE,
      skip: PAGE_SIZE,
      cursor
    });

    const expected = await readOrderedIds(`"created_at" DESC, "id" DESC`);

    deepEqual(
      records.map(({ id }) => id),
      expected.slice(PAGE_SIZE * 2, PAGE_SIZE * 3)
    );
  });

  it('assert :: find many with cursor and count', async () => {
    const cursor = await getFirstCursor();

    const { records, total } = await client.ez4_test_cursor.findMany({
      select: {
        id: true
      },
      order: {
        created_at: Order.Desc
      },
      take: PAGE_SIZE,
      count: true,
      cursor
    });

    const expected = await readOrderedIds(`"created_at" DESC, "id" DESC`);

    deepEqual(
      records.map(({ id }) => id),
      expected.slice(PAGE_SIZE, PAGE_SIZE * 2)
    );

    equal(total, TOTAL_ROWS);
  });

  it('assert :: find many records keep the selected fields', async () => {
    const { records, cursor } = await client.ez4_test_cursor.findMany({
      select: {
        id: true,
        created_at: true
      },
      order: {
        created_at: Order.Desc
      },
      take: 1
    });

    const [expectedId] = await readOrderedIds(`"created_at" DESC, "id" DESC`);

    deepEqual(records, [
      {
        id: expectedId,
        created_at: '2024-01-01T00:00:12.123Z'
      }
    ]);

    equal(typeof cursor, 'string');
  });

  it('assert :: find many with an invalid cursor', async () => {
    const encodeCursor = (payload: unknown) => {
      return Buffer.from(JSON.stringify(payload)).toString('base64url');
    };

    const invalidCursors = [
      'not-a-cursor',
      encodeCursor({ created_at: '2024-01-01T00:00:00.000000Z' }),
      encodeCursor([['created_at', '2024-01-01T00:00:00.000000Z']]),
      encodeCursor([
        ['created_at', 'abc'],
        ['id', 'abc']
      ]),
      encodeCursor([
        ['created_at', null],
        ['id', null]
      ])
    ];

    for (const cursor of invalidCursors) {
      await rejects(
        () =>
          client.ez4_test_cursor.findMany({
            select: {
              id: true
            },
            order: {
              created_at: Order.Desc
            },
            take: PAGE_SIZE,
            cursor
          }),
        InvalidCursorError
      );
    }
  });

  it('assert :: find many with a cursor of another order', async () => {
    const cursor = await getFirstCursor();

    await rejects(
      () =>
        client.ez4_test_cursor.findMany({
          select: {
            id: true
          },
          order: {
            category: Order.Desc
          },
          take: PAGE_SIZE,
          cursor
        }),
      InvalidCursorError
    );
  });

  it('assert :: find many with a cursor over a nullable column', async () => {
    const cursor = await getFirstCursor();

    await rejects(
      () =>
        client.ez4_test_cursor.findMany({
          select: {
            id: true
          },
          order: {
            label: Order.Desc
          },
          take: PAGE_SIZE,
          cursor
        }),
      UnsupportedCursorError
    );
  });

  it('assert :: find many with a cursor on a table without primary index', async () => {
    const cursor = await getFirstCursor();

    await rejects(
      () =>
        client.ez4_test_cursor_heap.findMany({
          select: {
            id: true
          },
          order: {
            created_at: Order.Desc
          },
          take: PAGE_SIZE,
          cursor
        }),
      UnsupportedCursorError
    );
  });
});
