import { makeSchemaClient, prepareSchemaTable } from './common/schema';

import { beforeEach, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

describe('client update json', async () => {
  const client = await makeSchemaClient();

  const id = randomUUID();

  beforeEach(async () => {
    await prepareSchemaTable(client);

    await client.ez4_test_table.insertOne({
      data: {
        id
      }
    });
  });

  it('assert :: update with optional column', async () => {
    const previous = await client.ez4_test_table.updateOne({
      select: {
        json: true
      },
      data: {
        json: {
          string: 'foo'
        }
      },
      where: {
        id
      }
    });

    deepEqual(previous, { json: null });

    const changes = await client.ez4_test_table.findOne({
      select: {
        json: true
      },
      where: {
        id
      }
    });

    deepEqual(changes, {
      json: {
        string: 'foo'
      }
    });
  });

  it('assert :: update extensible column with keys that read as sql', async () => {
    const forgedKey = "x', to_jsonb(current_database()), 'y";

    await client.ez4_test_table.updateOne({
      data: {
        extensible_json: {
          [forgedKey]: 1,
          'trailing\\': 'foo',
          nested: {
            [forgedKey]: true,
            'trailing\\': 'bar'
          }
        }
      },
      where: {
        id
      }
    });

    const changes = await client.ez4_test_table.findOne({
      select: {
        extensible_json: true
      },
      where: {
        id
      }
    });

    deepEqual(changes, {
      extensible_json: {
        [forgedKey]: 1,
        'trailing\\': 'foo',
        nested: {
          [forgedKey]: true,
          'trailing\\': 'bar'
        }
      }
    });
  });

  it('assert :: update extensible column with keys shaped like other types', async () => {
    const data = {
      '2024-07-01T08:00:00.000Z': 'datetime',
      '2024-07-01': 'date',
      'AB5C1E45-9F41-4E35-A1A3-3D37D3E7B6A1': 'uuid'
    };

    await client.ez4_test_table.updateOne({
      data: {
        extensible_json: data
      },
      where: {
        id
      }
    });

    const changes = await client.ez4_test_table.findOne({
      select: {
        extensible_json: true
      },
      where: {
        id
      }
    });

    deepEqual(changes, { extensible_json: data });
  });

  it('assert :: find by extensible column key that reads as sql', async () => {
    const key = "it's\\";

    await client.ez4_test_table.updateOne({
      data: {
        extensible_json: {
          [key]: 'foo'
        }
      },
      where: {
        id
      }
    });

    const result = await client.ez4_test_table.findMany({
      select: {
        id: true
      },
      where: {
        extensible_json: {
          [key]: {
            isMissing: false
          }
        }
      }
    });

    deepEqual(result, { records: [{ id }] });
  });
});
