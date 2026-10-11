import type { PgExecuteOptions, PgExecuteStatement } from '@ez4/pgclient';
import type { Arn } from '@ez4/aws-common';
import type { PoolClient } from 'pg';

import { rootCertificates } from 'node:tls';
import { setTimeout as sleep } from 'node:timers/promises';

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ClientDriver, createPool } from '@ez4/pgclient/driver';

import RdsCertificates from './rds-certificates.pem';
import { getAuthTokenSigner } from './token';

export type NativeClientConnection = {
  secretArn: Arn;
  endpoint: string;
  database: string;
  user?: string;
};

// A Lambda runs one invocation at a time, and a connection idle for longer than this is closed and opened
// again on the next query; it stays below the idle timeouts of an RDS Proxy and of the database role.
const POOL_SIZE = 1;
const IDLE_TIMEOUT = 300_000;

// Opening a connection is retried while the database restarts or resumes from a pause.
const CONNECT_ATTEMPTS = 6;
const CONNECT_DELAY = 500;

// When the pool last took each connection back, by the wall clock.
const IDLE_SINCE = new WeakMap<PoolClient, number>();

export class NativeClientDriver extends ClientDriver {
  #connection: NativeClientConnection;

  constructor(connection: NativeClientConnection) {
    // The services were written against the Data API, so raw queries keep its result shapes.
    super(undefined, { dataApiResults: true });

    this.#connection = connection;
  }

  async getConnection() {
    if (!this.pool) {
      this.pool = await createAuroraPool(this.#connection);
    }

    const connection = await connectWithRetry(() => super.getConnection());
    const idleSince = IDLE_SINCE.get(connection);

    // The pool's idle timer doesn't run while the Lambda is frozen, so a connection idle for longer than the
    // timeout is still handed out, and the proxy or the server may have closed it in the meantime.
    if (idleSince === undefined || Date.now() - idleSince < IDLE_TIMEOUT) {
      return connection;
    }

    connection.release(true);

    return connectWithRetry(() => super.getConnection());
  }

  async executeStatement(statement: PgExecuteStatement, options?: PgExecuteOptions) {
    if (options?.transactionId) {
      return super.executeStatement(statement, options);
    }

    return retryEndedConnection(() => super.executeStatement(statement, options));
  }

  async beginTransaction() {
    return retryEndedConnection(() => super.beginTransaction());
  }
}

const createAuroraPool = async (connection: NativeClientConnection) => {
  const { database, endpoint: host, user } = connection;

  const credentials = user ? getIamCredentials(host, user) : await getSecretCredentials(connection.secretArn);

  const pool = createPool({
    host,
    database,
    ...credentials,
    poolSize: POOL_SIZE,
    idleTimeout: IDLE_TIMEOUT,
    // The public roots trust an RDS Proxy (ACM certificate), the RDS bundle trusts the cluster itself.
    ssl: {
      ca: [...rootCertificates, RdsCertificates]
    }
  });

  pool.on('release', (_error, connection) => {
    IDLE_SINCE.set(connection, Date.now());
  });

  return pool;
};

const getIamCredentials = (hostname: string, username: string) => {
  const getAuthToken = getAuthTokenSigner(hostname, 5432, username);

  return {
    user: username,
    // A token lasts 15 minutes and is only checked when a connection opens, so each new one signs again.
    password: () => getAuthToken()
  };
};

const getSecretCredentials = async (secretArn: Arn) => {
  const client = new SecretsManagerClient();

  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

  const { username: user, password } = JSON.parse(response.SecretString!);

  return {
    user,
    password
  };
};

const connectWithRetry = async <T>(connect: () => Promise<T>) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connect();
    } catch (error) {
      if (attempt >= CONNECT_ATTEMPTS || !isUnavailableDatabase(error)) {
        throw error;
      }

      await sleep(CONNECT_DELAY * 2 ** (attempt - 1));
    }
  }
};

const retryEndedConnection = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error) {
    if (!isEndedConnection(error)) {
      throw error;
    }

    return operation();
  }
};

const UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', '57P03']);

// The pool raises both without a code: the first waiting for a free connection, the second when opening a new
// one takes longer than the connection timeout.
const UNAVAILABLE_MESSAGES = ['timeout exceeded when trying to connect', 'Connection terminated due to connection timeout'];

/**
 * The database can't take connections yet: refused, reset or slow to answer while it restarts or resumes, or
 * starting up. Nothing ran, so trying again is safe.
 */
export const isUnavailableDatabase = (error: unknown) => {
  const code = getErrorCode(error);

  if (code && UNAVAILABLE_CODES.has(code)) {
    return true;
  }

  return error instanceof Error && UNAVAILABLE_MESSAGES.some((message) => error.message.includes(message));
};

const ENDED_CODES = new Set(['57P01', '57P05']);

/**
 * The server ended the session (shutdown, idle session timeout) or the pooled client was already closed.
 * Either the statement never ran or the server rolled it back with the session, so running it again on a
 * new connection is safe; outside a transaction only, since a transaction's earlier statements are lost.
 */
export const isEndedConnection = (error: unknown) => {
  const code = getErrorCode(error);

  if (code && ENDED_CODES.has(code)) {
    return true;
  }

  return error instanceof Error && error.message.includes('is not queryable');
};

const getErrorCode = (error: unknown) => {
  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;

  return typeof code === 'string' ? code : undefined;
};
