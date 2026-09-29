import type { ClientDataApiOptions, PgExecuteOptions, PgExecuteStatement } from '@ez4/pgclient';
import type { PoolClient } from 'pg';

import { StatementTimeoutException } from '@ez4/pgclient';
import { DatabaseError } from 'pg';

import { assertSupportedResult, createResultTypes } from './results';
import { prepareStatement } from './prepare';

const DEFAULT_STATEMENT_TIMEOUT = 45000;

export const sendDataApiStatement = async (
  client: PoolClient,
  statement: PgExecuteStatement,
  dataApi: ClientDataApiOptions,
  options?: PgExecuteOptions
) => {
  // The Data API binds every occurrence of a named parameter on its own.
  const [query, variables] = prepareStatement(statement.query, statement.variables, true);

  const resultTypes = createResultTypes(!statement.metadata);

  const statementTimeout = options?.noTimeout ? 0 : (dataApi.statementTimeout ?? DEFAULT_STATEMENT_TIMEOUT);

  const inTransaction = !!options?.transactionId;

  // Inside a transaction the setting ends with it, otherwise it's reset before the connection goes back to the pool.
  await setStatementTimeout(client, statementTimeout, inTransaction);

  try {
    const result = await client.query({
      types: resultTypes,
      values: variables,
      text: query
    });

    // A query with several statements returns one result per statement, which goes back unchecked as in the default driver.
    if (!Array.isArray(result)) {
      assertSupportedResult(result, resultTypes.getFieldBytes());
    }

    return result;
  } catch (error) {
    if (isStatementTimeoutError(error)) {
      throw new StatementTimeoutException(error.message);
    }

    throw error;
  } finally {
    if (!inTransaction) {
      await client.query('RESET statement_timeout');
    }
  }
};

const setStatementTimeout = (client: PoolClient, statementTimeout: number, isLocal: boolean) => {
  return client.query(`SELECT set_config('statement_timeout', $1, $2)`, [`${statementTimeout}`, isLocal]);
};

const isStatementTimeoutError = (error: unknown): error is DatabaseError => {
  return error instanceof DatabaseError && error.code === '57014' && error.message.includes('statement timeout');
};
