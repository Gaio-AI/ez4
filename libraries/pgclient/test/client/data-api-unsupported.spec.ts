import { describe, it } from 'node:test';
import { rejects } from 'node:assert/strict';

import { makeDataApiClient } from './common/data-api';

describe('client data api unsupported results', () => {
  const client = makeDataApiClient();

  it('assert :: interval column', async () => {
    await rejects(client.rawQuery(`SELECT 1 AS "id", '1 day'::interval AS "value"`), {
      name: 'UnsupportedResultException',
      message: 'The result contains the unsupported data type INTERVAL.'
    });
  });

  it('assert :: time with time zone column', async () => {
    await rejects(client.rawQuery(`SELECT 1 AS "id", '17:08:20+02'::timetz AS "value"`), {
      name: 'UnsupportedResultException',
      message: 'The result contains the unsupported data type TIMETZ.'
    });
  });
});
