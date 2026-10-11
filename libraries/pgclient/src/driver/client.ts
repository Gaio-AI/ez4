import type { ClientDataApiOptions, PgClientDriver, PgExecuteOptions, PgExecuteStatement } from '@ez4/pgclient';
import type { AnySchema } from '@ez4/schema';
import type { Pool, PoolClient } from 'pg';

import { DuplicateUniqueKeyError } from '@ez4/pgclient';
import { Runtime } from '@ez4/common';

import { randomUUID } from 'crypto';
import { DatabaseError } from 'pg';

import { logQueryError, logQuerySuccess } from './utils/logger';
import { detectFieldData, prepareFieldData } from './utils/fields';
import { sendDataApiStatement } from './utils/data-api';
import { getDataApiResultTypes } from './utils/results';
import { prepareStatement } from './utils/prepare';
import { rollbackFailedTransaction } from '../utils/transaction';
import { parseRecords } from '../utils/records';

const ALL_TRANSACTIONS: Record<string, PoolClient> = {};

export type ClientDriverOptions = {
  dataApi?: boolean | ClientDataApiOptions;

  /**
   * Return raw results in the shapes the Data API driver returns, without the rest of its behavior.
   */
  dataApiResults?: boolean;
};

export class ClientDriver implements PgClientDriver {
  protected pool?: Pool;
  protected dataApi?: ClientDataApiOptions;
  protected dataApiResults?: boolean;

  constructor(pool?: Pool, options?: ClientDriverOptions) {
    this.pool = pool;
    this.dataApi = getDataApiOptions(options?.dataApi);
    this.dataApiResults = options?.dataApiResults;
  }

  async getConnection() {
    const connection = await this.pool?.connect();

    if (!connection) {
      throw new Error(`Unable to get a connection from the pool.`);
    }

    return connection;
  }

  async executeStatement(statement: PgExecuteStatement, options?: PgExecuteOptions) {
    const transactionId = options?.transactionId;

    const client = transactionId ? ALL_TRANSACTIONS[transactionId] : await this.getConnection();

    if (!client) {
      throw new Error(`Transaction '${transactionId}' wasn't found.`);
    }

    try {
      const { rows: records, rowCount: rows } = this.dataApi
        ? await sendDataApiStatement(client, statement, this.dataApi, options)
        : await sendStatement(client, statement, this.dataApiResults);

      if (options?.debug || Runtime.isDebug()) {
        logQuerySuccess(statement, transactionId);
      }

      const metadata = statement.metadata;

      if (metadata) {
        return {
          records: parseRecords(records, metadata),
          rows
        };
      }

      return {
        records,
        rows
      };
    } catch (error) {
      if (!options?.noErrorLog) {
        logQueryError(statement, transactionId);
      }

      if (isDuplicateUniqueKeyError(error)) {
        throw new DuplicateUniqueKeyError({ cause: error });
      }

      throw error;
      //
    } finally {
      if (!transactionId) {
        client.release();
      }
    }
  }

  async executeStatements(statements: PgExecuteStatement[], options?: PgExecuteOptions) {
    const results = [];

    for (const statement of statements) {
      const result = await this.executeStatement(statement, options);

      results.push(result);
    }

    return results;
  }

  async executeTransaction(statements: PgExecuteStatement[], options?: PgExecuteOptions) {
    const transactionId = await this.beginTransaction();

    let results;

    try {
      results = await this.executeStatements(statements, {
        ...options,
        transactionId
      });
    } catch (error) {
      await rollbackFailedTransaction(this, transactionId, error);

      throw error;
    }

    // Out of the try: a failed commit has already ended the transaction (or left it unknown), and a rollback would replace its error.
    await this.commitTransaction(transactionId);

    return results;
  }

  async beginTransaction() {
    const transactionId = randomUUID();
    const client = await this.getConnection();

    try {
      await client.query('BEGIN');
      ALL_TRANSACTIONS[transactionId] = client;
      return transactionId;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async commitTransaction(transactionId: string) {
    const client = ALL_TRANSACTIONS[transactionId];

    if (!client) {
      throw new Error(`Transaction '${transactionId}' wasn't found, unable to commit.`);
    }

    try {
      await client.query('COMMIT');
    } catch (error) {
      if (isDuplicateUniqueKeyError(error)) {
        throw new DuplicateUniqueKeyError({ cause: error });
      }

      throw error;
    } finally {
      delete ALL_TRANSACTIONS[transactionId];
      client.release();
    }
  }

  async rollbackTransaction(transactionId: string) {
    const client = ALL_TRANSACTIONS[transactionId];

    if (!client) {
      throw new Error(`Transaction '${transactionId}' wasn't found, unable to rollback.`);
    }

    try {
      await client.query('ROLLBACK');
    } finally {
      delete ALL_TRANSACTIONS[transactionId];
      client.release();
    }
  }

  prepareVariable(name: string, value: unknown, schema?: AnySchema) {
    if (schema) {
      return prepareFieldData(name, value, schema);
    }

    return detectFieldData(name, value);
  }
}

const getDataApiOptions = (dataApi: boolean | ClientDataApiOptions | undefined) => {
  if (dataApi === true) {
    return {};
  }

  return dataApi || undefined;
};

const sendStatement = (client: PoolClient, statement: PgExecuteStatement, dataApiResults?: boolean) => {
  const [query, variables] = prepareStatement(statement.query, statement.variables);

  if (dataApiResults) {
    return client.query({
      types: getDataApiResultTypes(!statement.metadata),
      values: variables,
      text: query
    });
  }

  return client.query(query, variables);
};

const isDuplicateUniqueKeyError = (error: unknown) => {
  return error instanceof DatabaseError && error.code === '23505';
};
