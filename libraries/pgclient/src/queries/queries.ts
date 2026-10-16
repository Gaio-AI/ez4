import type { ObjectSchema } from '@ez4/schema';
import type { SqlRecord } from '@ez4/pgsql';
import type { AnyObject } from '@ez4/utils';
import type { Query } from '@ez4/database';
import type { PgRelationRepositoryWithSchema } from '../types/repository';
import type { PgClientDriver, PgExecuteStatement } from '../types/driver';
import type { InternalTableMetadata } from '../types/table';
import type { InsertQueryOptions } from './insert';
import type { UpdateQueryOptions } from './update';
import type { DeleteQueryOptions } from './delete';
import type { PgAggregateInput } from './aggregate';
import type { SelectQueryOptions } from './select';

import { createQueryBuilder } from './utils/builder';

import { getInsertManyRecords, prepareInsertManyQuery, prepareInsertQuery } from './insert';
import { prepareUpsertQuery } from './upsert';
import { prepareUpdateQuery } from './update';
import { prepareSelectQuery } from './select';
import { prepareDeleteQuery } from './delete';
import { prepareExistsQuery } from './exists';
import { prepareCountQuery } from './count';
import { prepareAggregateQuery } from './aggregate';

export const prepareInsertOne = async <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.InsertOneInput<S, T>,
  options?: InsertQueryOptions
) => {
  const builder = createQueryBuilder(driver);

  const { queries, columns } = await prepareInsertQuery(builder, table, schema, relations, input, options);

  const [statement, variables] = builder.with(queries).build();

  return {
    query: statement,
    variables,
    metadata: {
      schema,
      relations,
      columns,
      table
    }
  };
};

export const prepareFindOne = <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.FindOneInput<S, T>
) => {
  const builder = createQueryBuilder(driver);

  const { query, columns } = prepareSelectQuery(builder, table, schema, relations, input);

  const [statement, variables] = query.build();

  return {
    query: statement,
    variables,
    metadata: {
      schema,
      relations,
      columns,
      table
    }
  };
};

export const prepareUpdateOne = async <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.UpdateOneInput<S, T>,
  options?: UpdateQueryOptions
) => {
  const builder = createQueryBuilder(driver);

  const { queries, columns, reloadKey } = await prepareUpdateQuery(builder, table, schema, relations, input, options);

  const [statement, variables] = builder.with(queries).build();

  return {
    query: statement,
    variables,
    reloadKey,
    metadata: {
      schema,
      relations,
      columns,
      table
    }
  };
};

export const prepareDeleteOne = <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.DeleteOneInput<S, T>
) => {
  const builder = createQueryBuilder(driver);

  const { queries, columns } = prepareDeleteQuery(builder, table, schema, relations, input);

  const [statement, variables] = builder.with(queries).build();

  return {
    query: statement,
    variables,
    metadata: {
      schema,
      relations,
      columns,
      table
    }
  };
};

export const prepareInsertMany = async <T extends InternalTableMetadata, S extends AnyObject>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.InsertManyInput<S, T>
) => {
  const records = await getInsertManyRecords(input.data, schema, relations, table);

  const prepareStatement = (chunk: SqlRecord[]) => {
    const builder = createQueryBuilder(driver);

    const { query, columns } = prepareInsertManyQuery(builder, table, schema, chunk, input);

    const [statement, variables] = query.build();

    return {
      query: statement,
      variables,
      metadata: {
        schema,
        relations,
        columns,
        table
      }
    };
  };

  // A chunk over the statement limits is split by how far it passes them, until each part fits or holds one record.
  const prepareStatements = (chunk: SqlRecord[]): PgExecuteStatement[] => {
    const statement = prepareStatement(chunk);
    const excess = getStatementExcess(statement);

    if (excess <= 1 || chunk.length === 1) {
      return [statement];
    }

    return getChunks(chunk, Math.max(Math.floor(chunk.length / excess), 1)).flatMap(prepareStatements);
  };

  const chunkSize = Math.floor(MAX_STATEMENT_PARAMETERS / Math.max(getColumnsCount(records), 1));

  return getChunks(records, chunkSize).flatMap(prepareStatements);
};

export const prepareUpsertOne = async <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.UpsertOneInput<S, T>,
  conflictColumns: string[]
) => {
  const builder = createQueryBuilder(driver);

  const result = await prepareUpsertQuery(builder, table, schema, relations, input, conflictColumns);

  if (!result) {
    return undefined;
  }

  const { query, columns, skipsUpdate } = result;

  const [statement, variables] = query.build();

  return {
    query: statement,
    variables,
    skipsUpdate,
    metadata: {
      schema,
      relations,
      columns,
      table
    }
  };
};

export const prepareFindMany = <T extends InternalTableMetadata, S extends Query.SelectInput<T>, C extends boolean>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.FindManyInput<S, C, T>,
  options?: SelectQueryOptions
) => {
  const builder = createQueryBuilder(driver);

  const { query, columns, cursorFields } = prepareSelectQuery(builder, table, schema, relations, input, options);

  const [statement, variables] = query.build();

  return {
    cursorFields,
    statement: {
      query: statement,
      variables,
      metadata: {
        schema,
        relations,
        columns,
        table
      }
    }
  };
};

export const prepareUpdateMany = async <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.UpdateManyInput<S, T>,
  options?: UpdateQueryOptions
) => {
  const builder = createQueryBuilder(driver);

  const { queries, columns, reloadKey } = await prepareUpdateQuery(builder, table, schema, relations, input, options);

  const [statement, variables] = builder.with(queries).build();

  return {
    query: statement,
    variables,
    reloadKey,
    metadata: {
      schema,
      relations,
      columns,
      table
    }
  };
};

export const prepareDeleteMany = <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.DeleteManyInput<S, T>,
  options?: DeleteQueryOptions
) => {
  const builder = createQueryBuilder(driver);

  const { queries, columns } = prepareDeleteQuery(builder, table, schema, relations, input, options);

  const [statement, variables] = builder.with(queries).build();

  return {
    query: statement,
    variables,
    metadata: {
      schema,
      relations,
      columns,
      table
    }
  };
};

export const prepareExists = <T extends InternalTableMetadata>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.ExistsInput<T>
) => {
  const builder = createQueryBuilder(driver);

  const { query, columns } = prepareExistsQuery(builder, table, schema, relations, input);

  const [statement, variables] = query.build();

  return {
    query: statement,
    variables,
    metadata: {
      schema,
      relations,
      columns,
      table
    }
  };
};

export const prepareCount = <T extends InternalTableMetadata>(
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: Query.CountInput<T>
) => {
  const builder = createQueryBuilder(driver);

  const { query, columns } = prepareCountQuery(builder, table, schema, relations, input);

  const [statement, variables] = query.build();

  return {
    query: statement,
    variables,
    metadata: {
      schema,
      relations,
      columns,
      table
    }
  };
};

export const prepareAggregate = (
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  driver: PgClientDriver,
  input: PgAggregateInput
) => {
  const builder = createQueryBuilder(driver);

  const { query, columns, schema: resultSchema } = prepareAggregateQuery(builder, table, schema, relations, input);

  const [statement, variables] = query.build();

  // Results hold no relation, and an alias may take the name of one.
  return {
    query: statement,
    variables,
    metadata: {
      schema: resultSchema,
      relations: {},
      columns,
      table
    }
  };
};

// Postgres binds at most 65,535 parameters in one statement.
const MAX_STATEMENT_PARAMETERS = 65535;

// The Data API takes at most 65,536 characters of SQL in a request of at most 4 MiB, so the variables keep a margin
// for the statement and the request envelope.
const MAX_STATEMENT_LENGTH = 65536;
const MAX_VARIABLES_SIZE = 3 * 1024 * 1024;

const getStatementExcess = (statement: PgExecuteStatement) => {
  const variablesSize = Buffer.byteLength(JSON.stringify(statement.variables ?? []));

  return Math.max(statement.query.length / MAX_STATEMENT_LENGTH, variablesSize / MAX_VARIABLES_SIZE);
};

const getColumnsCount = (records: SqlRecord[]) => {
  const columns = new Set<string>();

  for (const record of records) {
    for (const column in record) {
      if (record[column] !== undefined) {
        columns.add(column);
      }
    }
  }

  return columns.size;
};

const getChunks = <T>(list: T[], size: number) => {
  const chunks = [];

  for (let offset = 0; offset < list.length; offset += size) {
    chunks.push(list.slice(offset, offset + size));
  }

  return chunks;
};
