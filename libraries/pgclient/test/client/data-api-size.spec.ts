import { describe, it } from 'node:test';
import { equal, rejects } from 'node:assert/strict';

import { makeDataApiClient } from './common/data-api';

// Each row costs 2 bytes, plus 4 bytes per column, plus the octets of every field.
const UUID_QUERY = `SELECT md5("value"::text)::uuid AS "id" FROM generate_series(1, :rows) AS "value"`;

const MULTIPLE_COLUMNS_QUERY =
  `SELECT ` +
  `md5("value"::text)::uuid AS "a", ` +
  `md5(("value" + 1)::text)::uuid AS "b", ` +
  `md5(("value" + 2)::text)::uuid AS "c", ` +
  `repeat('x', 20) AS "d", ` +
  `repeat('y', 8) AS "e" ` +
  `FROM generate_series(1, :rows) AS "value"`;

const MULTIBYTE_QUERY = `SELECT repeat('é', 1000) AS "text" FROM generate_series(1, :rows)`;

const SIZE_LIMIT_ERROR = {
  name: 'UnsupportedResultException',
  message: 'The result exceeds the size limit 1 MB.'
};

describe('client data api result size', () => {
  const client = makeDataApiClient();

  it('assert :: one column under the limit', async () => {
    const result = await client.rawQuery(UUID_QUERY, { rows: 24800 });

    equal(result.length, 24800);
  });

  it('assert :: one column over the limit', async () => {
    await rejects(client.rawQuery(UUID_QUERY, { rows: 25000 }), SIZE_LIMIT_ERROR);
  });

  it('assert :: multiple columns under the limit', async () => {
    const result = await client.rawQuery(MULTIPLE_COLUMNS_QUERY, { rows: 6625 });

    equal(result.length, 6625);
  });

  it('assert :: multiple columns over the limit', async () => {
    await rejects(client.rawQuery(MULTIPLE_COLUMNS_QUERY, { rows: 6640 }), SIZE_LIMIT_ERROR);
  });

  it('assert :: multibyte characters under the limit', async () => {
    const result = await client.rawQuery(MULTIBYTE_QUERY, { rows: 522 });

    equal(result.length, 522);
  });

  it('assert :: multibyte characters over the limit', async () => {
    await rejects(client.rawQuery(MULTIBYTE_QUERY, { rows: 523 }), SIZE_LIMIT_ERROR);
  });
});
