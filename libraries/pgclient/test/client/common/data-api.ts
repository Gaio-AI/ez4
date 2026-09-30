import type { Database } from '@ez4/database';
import type { ClientDataApiOptions, PostgresEngine } from '@ez4/pgclient';

import { Client } from '@ez4/pgclient/driver';

export declare class TestDataApiDb extends Database.Service<PostgresEngine> {
  tables: [];
}

export const TestConnection = {
  database: 'postgres',
  password: 'postgres',
  user: 'postgres',
  host: '127.0.0.1'
};

export const makeDataApiClient = (dataApi: boolean | ClientDataApiOptions = true) => {
  return Client.make<TestDataApiDb>({
    debug: false,
    repository: {},
    connection: {
      ...TestConnection,
      dataApi
    }
  });
};
