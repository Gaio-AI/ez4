import type { DatabaseService } from '@ez4/database/library';
import type { ServeOptions } from '@ez4/project/library';
import type { AnyObject } from '@ez4/utils';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConnectionMode } from '../src/client/types';
import { getConnectionOptions, getMigrationConnectionOptions } from '../src/local/options';

const LOCAL_OPTIONS = {
  user: 'postgres',
  password: 'postgres',
  host: '127.0.0.1',
  port: 5432
};

const getService = (options?: AnyObject) => {
  return {
    type: '@ez4/database',
    name: 'testDb',
    context: {},
    variables: {},
    services: {},
    tables: [],
    engine: {
      name: 'aurora'
    },
    options
  } as unknown as DatabaseService;
};

const getServeOptions = (localOptions: AnyObject, testOptions?: AnyObject) => {
  return {
    prefix: 'ez4',
    projectName: 'test',
    branchName: '',
    serviceHost: 'localhost',
    version: 1,
    test: !!testOptions,
    localOptions: {
      test_db: localOptions
    },
    testOptions: {
      ...(testOptions && {
        test_db: testOptions
      })
    }
  } as ServeOptions;
};

describe('aurora local connection options', () => {
  it('assert :: connection without data api (default)', () => {
    const connection = getConnectionOptions(getService(), getServeOptions(LOCAL_OPTIONS));

    deepEqual(connection, {
      database: 'test_test_db',
      host: '127.0.0.1',
      password: 'postgres',
      user: 'postgres',
      port: 5432,
      poolSize: undefined,
      dataApi: undefined
    });
  });

  it('assert :: data api connection (opted in)', () => {
    const { dataApi } = getConnectionOptions(getService(), getServeOptions({ ...LOCAL_OPTIONS, dataApi: true }));

    deepEqual(dataApi, {});
  });

  it('assert :: data api connection (opted in with options)', () => {
    const service = getService({ connectionMode: ConnectionMode.Api });

    const { dataApi } = getConnectionOptions(service, getServeOptions({ ...LOCAL_OPTIONS, dataApi: { statementTimeout: 1000 } }));

    deepEqual(dataApi, {
      statementTimeout: 1000
    });
  });

  it('assert :: native connection (opted in)', () => {
    const service = getService({ connectionMode: ConnectionMode.Native });

    const { dataApi } = getConnectionOptions(service, getServeOptions({ ...LOCAL_OPTIONS, dataApi: true }));

    deepEqual(dataApi, undefined);
  });

  it('assert :: connection with test options', () => {
    const options = getServeOptions(
      { ...LOCAL_OPTIONS, poolSize: 10, dataApi: { statementTimeout: 1000 } },
      { database: 'tests', dataApi: { statementTimeout: 500 } }
    );

    const { database, poolSize, dataApi } = getConnectionOptions(getService(), options);

    deepEqual(database, 'tests');
    deepEqual(poolSize, 10);

    deepEqual(dataApi, {
      statementTimeout: 500
    });
  });

  it('assert :: migration connection (opted in)', () => {
    const options = getServeOptions({ ...LOCAL_OPTIONS, poolSize: 10, dataApi: { statementTimeout: 1000 } });

    const { poolSize, dataApi } = getMigrationConnectionOptions(getService(), options);

    deepEqual(poolSize, 10);

    deepEqual(dataApi, {
      statementTimeout: 0
    });
  });

  it('assert :: migration connection (without data api)', () => {
    const { dataApi } = getMigrationConnectionOptions(getService(), getServeOptions(LOCAL_OPTIONS));

    deepEqual(dataApi, undefined);
  });
});
