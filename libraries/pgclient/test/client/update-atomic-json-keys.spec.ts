import type { Database, Client as DbClient } from '@ez4/database';
import type { PgTableRepository } from '@ez4/pgclient/library';
import type { PostgresEngine } from '@ez4/pgclient';
import type { String } from '@ez4/schema';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { getCreateQueries } from '@ez4/pgmigration';
import { Client } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { runMigration } from './common/migration';

declare class TestJsonKeysDb extends Database.Service<PostgresEngine> {
  tables: [
    Database.UseTable<{
      name: 'ez4_test_json_keys';
      schema: {
        id: String.UUID;
        json: {
          'a,b'?: number;
          'c}'?: number;
          'd"e'?: number;
          'f\\g'?: number;
          a?: {
            b?: number;
          };
          plain?: number;
        };
      };
      indexes: {
        id: Index.Primary;
      };
    }>
  ];
}

const optionalNumber = {
  type: SchemaType.Number,
  format: 'integer',
  optional: true
} as const;

const TestJsonKeysRepository: PgTableRepository = {
  ez4_test_json_keys: {
    name: 'ez4_test_json_keys',
    relations: {},
    indexes: {
      id: {
        name: 'id',
        columns: ['id'],
        type: Index.Primary
      }
    },
    schema: {
      type: SchemaType.Object,
      properties: {
        id: {
          type: SchemaType.String,
          format: 'uuid'
        },
        json: {
          type: SchemaType.Object,
          properties: {
            'a,b': optionalNumber,
            'c}': optionalNumber,
            'd"e': optionalNumber,
            'f\\g': optionalNumber,
            a: {
              type: SchemaType.Object,
              optional: true,
              properties: {
                b: optionalNumber
              }
            },
            plain: optionalNumber
          }
        }
      }
    }
  }
};

const makeJsonKeysClient = (dataApi: boolean) => {
  return Client.make<TestJsonKeysDb>({
    repository: TestJsonKeysRepository,
    debug: false,
    connection: {
      database: 'postgres',
      password: 'postgres',
      user: 'postgres',
      host: '127.0.0.1',
      dataApi
    }
  });
};

const prepareJsonKeysTable = async (client: DbClient<TestJsonKeysDb>) => {
  await client.rawQuery(`DROP TABLE IF EXISTS "ez4_test_json_keys"`);
  await runMigration(client, getCreateQueries(TestJsonKeysRepository));
};

const fullJson = {
  'a,b': 1,
  'c}': 2,
  'd"e': 3,
  'f\\g': 4,
  a: {
    b: 5
  },
  plain: 6
};

for (const dataApi of [false, true]) {
  describe(`client update json atomic remove keys (${dataApi ? 'data api' : 'native'})`, async () => {
    const client = await makeJsonKeysClient(dataApi);

    const id = randomUUID();

    beforeEach(async () => {
      await prepareJsonKeysTable(client);

      await client.ez4_test_json_keys.insertOne({
        data: {
          id,
          json: fullJson
        }
      });
    });

    const removeKey = async (key: keyof typeof fullJson) => {
      await client.ez4_test_json_keys.updateOne({
        data: {
          json: {
            [key]: {
              removeFrom: true
            }
          }
        },
        where: {
          id
        }
      });

      const record = await client.ez4_test_json_keys.findOne({
        select: {
          json: true
        },
        where: {
          id
        }
      });

      return record?.json;
    };

    const withoutKey = (key: keyof typeof fullJson) => {
      const { [key]: _removed, ...rest } = fullJson;
      return rest;
    };

    it('assert :: remove a key with a comma (not the nested path a.b)', async () => {
      deepEqual(await removeKey('a,b'), withoutKey('a,b'));
    });

    it('assert :: remove a key with a closing brace', async () => {
      deepEqual(await removeKey('c}'), withoutKey('c}'));
    });

    it('assert :: remove a key with a double quote', async () => {
      deepEqual(await removeKey('d"e'), withoutKey('d"e'));
    });

    it('assert :: remove a key with a backslash', async () => {
      deepEqual(await removeKey('f\\g'), withoutKey('f\\g'));
    });

    it('assert :: remove a plain key', async () => {
      deepEqual(await removeKey('plain'), withoutKey('plain'));
    });
  });
}
