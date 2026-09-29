import { deepEqual, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeDataApiClient } from './common/data-api';

const GROUP_BY_SOURCE = `(VALUES ('2026-09-17 10:00:00+00'::timestamptz), ('2026-09-17 11:00:00+00'::timestamptz)) AS "events" ("at")`;

const GROUP_BY_NAMED_QUERY = `SELECT date_trunc(:unit, "at") AS "day", count(*) AS "total" FROM ${GROUP_BY_SOURCE} GROUP BY date_trunc(:unit, "at")`;

const GROUP_BY_INDEX_QUERY = `SELECT date_trunc(:0, "at") AS "day", count(*) AS "total" FROM ${GROUP_BY_SOURCE} GROUP BY date_trunc(:0, "at")`;

describe('client data api bindings', () => {
  const defaultClient = makeDataApiClient(false);
  const dataApiClient = makeDataApiClient();

  it('assert :: repeated named binding (default driver)', async () => {
    const result = await defaultClient.rawQuery(GROUP_BY_NAMED_QUERY, { unit: 'day' });

    deepEqual(result, [{ day: new Date('2026-09-17T00:00:00Z'), total: '2' }]);
  });

  it('assert :: repeated named binding (one bind per occurrence)', async () => {
    await rejects(dataApiClient.rawQuery(GROUP_BY_NAMED_QUERY, { unit: 'day' }), { code: '42803' });
  });

  it('assert :: repeated index binding (one bind per occurrence)', async () => {
    await rejects(dataApiClient.rawQuery(GROUP_BY_INDEX_QUERY, ['day']), { code: '42803' });
  });

  it('assert :: repeated named binding values', async () => {
    const result = await dataApiClient.rawQuery('SELECT (:foo + :bar + :foo + :baz)::int AS alive', { bar: 2, foo: 1, baz: 4 });

    deepEqual(result, [{ alive: 8 }]);
  });

  it('assert :: repeated index binding values', async () => {
    const result = await dataApiClient.rawQuery('SELECT (:1 + :0 + :1 + :2)::int AS alive', [1, 2, 3]);

    deepEqual(result, [{ alive: 8 }]);
  });
});
