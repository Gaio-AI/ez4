import type { SqlBuilder, SqlFilters } from '@ez4/pgsql';
import type { ObjectSchema } from '@ez4/schema';
import type { Query } from '@ez4/database';
import type { PgRelationRepositoryWithSchema } from '../types/repository';
import type { InternalTableMetadata } from '../types/table';

import { isAnyObject, isEmptyObject, isNullish } from '@ez4/utils';
import { mergeSqlAlias } from '@ez4/pgsql';

import { getInsertRecord, getRelationQueries, preparePostInsertRelations, preparePreInsertRelations } from './insert';
import { getUpdateRecord, rewritesOtherTables } from './update';
import { getSelectFields, getSelectFilters } from './select';

export const UPSERT_INSERTED_FLAG = '__EZ4_INSERTED';

/**
 * Prepare the upsert as one `INSERT … ON CONFLICT` statement, or return `undefined` when one statement can't express
 * it: the record before the update, writes to other tables, or a conflict target the insert doesn't hit.
 */
export const prepareUpsertQuery = async <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  builder: SqlBuilder,
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  input: Query.UpsertOneInput<S, T>,
  conflictColumns: string[]
) => {
  if (input.previous || rewritesOtherTables(input.update, relations, table)) {
    return undefined;
  }

  // The alias names the existing record inside the update, as an unqualified column would.
  const insertQuery = builder.insert(schema).into(table).as(builder.alias('R')).returning();

  const preInsertQueries = preparePreInsertRelations(builder, input.insert, relations, table);
  const postInsertQueries = preparePostInsertRelations(builder, input.insert, relations, insertQuery, table);

  if (getRelationQueries(preInsertQueries).length || getRelationQueries(postInsertQueries).length) {
    return undefined;
  }

  // Checked on the record the insert writes, where a connected relation has already become its foreign key column.
  const insertRecord = await getInsertRecord(input.insert, schema, relations, preInsertQueries, table);

  if (!isConflictTarget(input.where, insertRecord, conflictColumns)) {
    return undefined;
  }

  const updateRecord = await getUpdateRecord(builder, input.update, schema, relations, table);

  insertQuery.record(insertRecord);

  const skipsUpdate = isEmptyObject(updateRecord);

  if (skipsUpdate) {
    insertQuery.conflict(conflictColumns);
  } else {
    const filters = getUpdateFilters(input.where, conflictColumns);

    insertQuery.conflict(conflictColumns, updateRecord, getSelectFilters(builder, filters, relations, insertQuery, table));
  }

  const columns = [];

  if (input.select) {
    const record = getSelectFields(builder, input.select, input.include, schema, relations, insertQuery, table);

    insertQuery.returning(record);
    columns.push(...Object.keys(record));
  }

  // The record the statement inserts has no transaction in `xmax`, while the update leaves its own there.
  insertQuery.results.rawColumn((source) => `(${mergeSqlAlias('xmax', source?.alias)} = 0)`, UPSERT_INSERTED_FLAG);
  columns.push(UPSERT_INSERTED_FLAG);

  return {
    query: insertQuery,
    skipsUpdate,
    columns
  };
};

// The conflict is the record the filters name only when the insert carries the same key, and a null never conflicts.
const isConflictTarget = (where: SqlFilters, record: SqlFilters, conflictColumns: string[]) => {
  return conflictColumns.every((column) => {
    const value = where[column];

    return !isNullish(value) && !isAnyObject(value) && record[column] === value;
  });
};

// The conflict columns match by the conflict itself, the other filters decide whether the existing record is updated.
// Whether what is left holds a condition is up to the WHERE clause: an operand such as `{ equal: {} }` is one.
const getUpdateFilters = (where: SqlFilters, conflictColumns: string[]) => {
  const filters = { ...where };

  for (const column of conflictColumns) {
    delete filters[column];
  }

  return filters;
};
