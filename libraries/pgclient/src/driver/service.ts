import type { Database, Client as DbClient } from '@ez4/database';
import type { PgTableRepository } from '@ez4/pgclient/library';
import type { ClientConnection } from '../types/connection';

import { Pool } from 'pg';

import { PgClient } from '@ez4/pgclient';
import { Runtime } from '@ez4/common';

import { ClientDriver } from './client';

export type ClientContext = {
  connection: ClientConnection;
  repository: PgTableRepository;
  debug?: boolean;
};

const DB_POOL: Record<string, Pool> = {};

export namespace Client {
  export const make = <T extends Database.Service<any>>(context: ClientContext): DbClient<T> => {
    const { connection, repository, debug } = context;
    const { database } = connection;

    if (!DB_POOL[database]) {
      DB_POOL[database] = createPool(connection);
    }

    return PgClient.make({
      driver: new ClientDriver(DB_POOL[database], {
        dataApi: connection.dataApi
      }),
      repository,
      debug
    });
  };
}

export const createPool = (connection: ClientConnection) => {
  const baseOptions = {
    allowExitOnIdle: true,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: connection.idleTimeout ?? 15000,
    maxUses: 500,
    min: 0,
    max: connection.poolSize ?? 2,
    ssl: connection.ssl
  };

  if ('connectionString' in connection && connection.connectionString) {
    return listenIdleErrors(new Pool({ ...baseOptions, connectionString: connection.connectionString }));
  }

  const { database, password, user, host, port } = connection as Extract<ClientConnection, { host: string }>;

  return listenIdleErrors(
    new Pool({
      ...baseOptions,
      ssl: connection.ssl ?? false,
      database,
      password,
      user,
      host,
      port
    })
  );
};

// The server or a proxy may end an idle pooled connection (idle session timeout, restart, failover), and in a
// Lambda that surfaces when the frozen container resumes. The pool emits it as an 'error' event, which crashes
// the process when nothing listens. The pool already discards that client, so the next query connects again.
const listenIdleErrors = (pool: Pool) => {
  pool.on('error', (error) => {
    console.warn({
      type: 'PgSQL',
      ...Runtime.getScope(),
      idleConnectionEnded: {
        code: Reflect.get(error, 'code'),
        message: error.message
      }
    });
  });

  return pool;
};
