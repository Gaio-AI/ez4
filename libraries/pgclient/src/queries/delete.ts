import type { ObjectSchema } from '@ez4/schema';
import type { SqlBuilder, SqlDeleteStatement, SqlFilters, SqlSelectStatement } from '@ez4/pgsql';
import type { Query } from '@ez4/database';
import type { PgRelationRepositoryWithSchema } from '../types/repository';
import type { InternalTableMetadata } from '../types/table';

import { isAnyNumber } from '@ez4/utils';

import { getSelectFilters, getSelectFields } from './select';
import { getKeyAlias, prepareKeyQuery } from './update';

export type DeleteQueryOptions = {
  primaryKey?: string[];
};

export const prepareDeleteQuery = <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  builder: SqlBuilder,
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  input: Query.DeleteOneInput<S, T> | Query.DeleteManyInput<S, T>,
  options?: DeleteQueryOptions
) => {
  const query = builder.reset().delete(schema).from(table);
  const queries: (SqlSelectStatement | SqlDeleteStatement)[] = [];
  const columns = [];

  const take = 'take' in input && isAnyNumber(input.take) ? input.take : undefined;

  if (take === undefined) {
    if (input.where) {
      query.where(getSelectFilters(builder, input.where, relations, query, table));
    }
  } else {
    const primaryKey = options?.primaryKey ?? [];
    const keyQuery = prepareKeyQuery(builder, table, schema, relations, input.where, primaryKey).take(take);

    query.as(builder.alias('R'));

    // Inside the match the key columns of the page are unqualified, and the deleted record's columns carry its alias.
    const keyFilters: SqlFilters = {};

    primaryKey.forEach((column, index) => {
      keyFilters[getKeyAlias(index)] = query.reference(column);
    });

    const keyMatch = builder.select().from(keyQuery.reference()).rawColumn(1).where(keyFilters);

    // The filters apply again to the records of the page, so one that another write changed meanwhile and no longer
    // matches is left alone.
    const filters = input.where ? [getSelectFilters(builder, input.where, relations, query, table)] : [];

    query.where({ AND: [...filters, { __EZ4_KEY: keyMatch }] });

    queries.push(keyQuery);
  }

  if (input.select) {
    const record = getSelectFields(builder, input.select, input.include, schema, relations, query, table);

    columns.push(...Object.keys(input.select));

    query.returning(record);
  }

  queries.push(query);

  return {
    columns,
    queries
  };
};
