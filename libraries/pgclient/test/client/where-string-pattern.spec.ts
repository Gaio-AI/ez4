import { makeSchemaClient, prepareSchemaTable } from './common/schema';

import { before, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

describe('client where string pattern', async () => {
  const client = await makeSchemaClient();

  before(async () => {
    await prepareSchemaTable(client);

    await client.ez4_test_table.insertMany({
      data: [
        {
          id: randomUUID(),
          string: 'a_b'
        },
        {
          id: randomUUID(),
          string: 'aXb'
        },
        {
          id: randomUUID(),
          string: '50% off'
        },
        {
          id: randomUUID(),
          string: '500 units'
        },
        {
          id: randomUUID(),
          string: 'back\\slash'
        },
        {
          id: randomUUID(),
          string: 'backslash'
        }
      ]
    });
  });

  it('assert :: where string (contains underscore)', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        string: {
          contains: '_'
        }
      }
    });

    deepEqual(records, [{ string: 'a_b' }]);
  });

  it('assert :: where string (contains percent)', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        string: {
          contains: '%'
        }
      }
    });

    deepEqual(records, [{ string: '50% off' }]);
  });

  it('assert :: where string (contains backslash)', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        string: {
          contains: 'k\\s'
        }
      }
    });

    deepEqual(records, [{ string: 'back\\slash' }]);
  });

  it('assert :: where string (insensitive contains underscore)', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        string: {
          contains: 'A_B',
          insensitive: true
        }
      }
    });

    deepEqual(records, [{ string: 'a_b' }]);
  });

  it('assert :: where string (starts with percent)', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        string: {
          startsWith: '50%'
        }
      }
    });

    deepEqual(records, [{ string: '50% off' }]);
  });

  it('assert :: where string (starts with backslash)', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        string: {
          startsWith: 'back\\'
        }
      }
    });

    deepEqual(records, [{ string: 'back\\slash' }]);
  });

  it('assert :: where string (insensitive starts with underscore)', async () => {
    const { records } = await client.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        string: {
          startsWith: 'A_',
          insensitive: true
        }
      }
    });

    deepEqual(records, [{ string: 'a_b' }]);
  });

  it('assert :: where string (data api)', async () => {
    const dataApiClient = await makeSchemaClient(false, true);

    const { records } = await dataApiClient.ez4_test_table.findMany({
      select: {
        string: true
      },
      where: {
        OR: [
          {
            string: {
              contains: 'A_B',
              insensitive: true
            }
          },
          {
            string: {
              startsWith: '50%'
            }
          }
        ]
      }
    });

    deepEqual(records, [{ string: 'a_b' }, { string: '50% off' }]);
  });
});
