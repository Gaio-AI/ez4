import type { SqlAggregateFunction, SqlBuilder, SqlFilters, SqlOrder, SqlResultRecord } from '@ez4/pgsql';
import type { AnySchema, ObjectSchema } from '@ez4/schema';
import type { PgRelationRepositoryWithSchema } from '../types/repository';

import {
  DuplicateAggregateAliasError,
  EmptyAggregateQueryError,
  InvalidAggregateColumnError,
  InvalidAggregateFieldError,
  MissingFieldSchemaError
} from '@ez4/pgclient';

import { isEnumSchema, isNumberSchema, isStringSchema, SchemaType } from '@ez4/schema';
import { isAnyNumber, isAnyString } from '@ez4/utils';

import { getExpressionFormatter, getFormattedColumn } from './utils/formats';
import { getSelectFilters } from './select';

export type PgAggregateField = {
  count?: boolean | string;
  sum?: string;
  min?: string;
  max?: string;
  distinct?: boolean;
  where?: SqlFilters;
};

export type PgAggregateInput = {
  by?: string[];
  select: Record<string, PgAggregateField>;
  where?: SqlFilters;
  order?: SqlOrder;
  skip?: number;
  take?: number;
};

const AGGREGATE_FUNCTIONS: SqlAggregateFunction[] = ['count', 'sum', 'min', 'max'];

const COUNT_SCHEMA: AnySchema = {
  type: SchemaType.Number,
  format: 'integer'
};

const SUM_SCHEMA: AnySchema = {
  type: SchemaType.Number,
  nullable: true
};

export const prepareAggregateQuery = (
  builder: SqlBuilder,
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  input: PgAggregateInput
) => {
  const query = builder.select(schema).from(table);

  // Results follow the group columns and the aggregates instead of the table schema.
  const resultSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {}
  };

  const groupColumns = input.by ?? [];
  const groupRecord: SqlResultRecord = {};

  for (const column of groupColumns) {
    const columnSchema = getColumnSchema(table, schema, column);
    const formattedColumn = getFormattedColumn(column, columnSchema);

    groupRecord[column] = formattedColumn instanceof Function ? query.reference(formattedColumn, column) : true;
    resultSchema.properties[column] = columnSchema;
  }

  query.record(groupRecord);

  const aliases = Object.keys(input.select);

  if (!groupColumns.length && !aliases.length) {
    throw new EmptyAggregateQueryError();
  }

  for (const alias of aliases) {
    if (groupColumns.includes(alias)) {
      throw new DuplicateAggregateAliasError(alias);
    }

    const field = input.select[alias];
    const operation = getAggregateFunction(alias, field);
    const column = field[operation];

    const filters = field.where && getSelectFilters(builder, field.where, relations, query, table);

    if (operation === 'count' && column === true) {
      query.aggregateColumn({ function: operation, filters, alias });
      resultSchema.properties[alias] = COUNT_SCHEMA;
      continue;
    }

    if (!isAnyString(column)) {
      throw new InvalidAggregateFieldError(alias);
    }

    const columnSchema = getColumnSchema(table, schema, column);

    if (!isAggregateColumn(operation, columnSchema)) {
      throw new InvalidAggregateColumnError(alias, column);
    }

    switch (operation) {
      case 'count':
        query.aggregateColumn({ function: operation, column, distinct: field.distinct, filters, alias });
        resultSchema.properties[alias] = COUNT_SCHEMA;
        break;

      case 'sum':
        query.aggregateColumn({ function: operation, column, filters, alias });
        resultSchema.properties[alias] = SUM_SCHEMA;
        break;

      case 'min':
      case 'max':
        query.aggregateColumn({ function: operation, column, filters, alias, format: getExpressionFormatter(columnSchema) });
        resultSchema.properties[alias] = columnSchema;
        break;
    }
  }

  if (input.where) {
    query.where(getSelectFilters(builder, input.where, relations, query, table));
  }

  if (groupColumns.length) {
    query.group(...groupColumns);
  }

  if (input.order) {
    query.order(input.order);
  }

  if (isAnyNumber(input.skip)) {
    query.skip(input.skip);
  }

  if (isAnyNumber(input.take)) {
    query.take(input.take);
  }

  return {
    columns: [...Object.keys(groupRecord), ...aliases],
    schema: resultSchema,
    query
  };
};

const getColumnSchema = (table: string, schema: ObjectSchema, column: string) => {
  const columnSchema = schema.properties[column];

  if (!columnSchema) {
    throw new MissingFieldSchemaError(`${table}.${column}`);
  }

  return columnSchema;
};

const getAggregateFunction = (alias: string, field: PgAggregateField) => {
  const operations = AGGREGATE_FUNCTIONS.filter((operation) => field[operation] !== undefined && field[operation] !== false);

  if (operations.length !== 1) {
    throw new InvalidAggregateFieldError(alias);
  }

  return operations[0];
};

const isAggregateColumn = (operation: SqlAggregateFunction, schema: AnySchema) => {
  switch (operation) {
    case 'count':
      return true;

    case 'sum':
      return isNumberSchema(schema);

    case 'min':
    case 'max':
      // Postgres has no lowest or highest uuid.
      return isNumberSchema(schema) || isEnumSchema(schema) || (isStringSchema(schema) && schema.format !== 'uuid');
  }
};
