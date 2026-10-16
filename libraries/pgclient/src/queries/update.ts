import type { SqlSourceWithResults, SqlRecord, SqlBuilder, SqlFilters, SqlUpdateStatement } from '@ez4/pgsql';
import type { AnySchema, NumberSchema, ObjectSchema, UnionSchema } from '@ez4/schema';
import type { AnyObject } from '@ez4/utils';
import type { Query } from '@ez4/database';
import type { PgRelationRepositoryWithSchema, PgRelationWithSchema } from '../types/repository';
import type { InternalTableMetadata } from '../types/table';

import { InvalidAtomicOperation, InvalidFieldSchemaError, InvalidRelationFieldError, MissingPrimaryIndexError } from '@ez4/pgclient';
import { getOptionalSchema, getSchemaProperty, isNumberSchema, isObjectSchema, isUnionSchema } from '@ez4/schema';
import { isAnyNumber, isAnyObject, isEmptyObject, isNullish } from '@ez4/utils';
import { SqlSelectStatement, escapeSqlName, mergeSqlAlias } from '@ez4/pgsql';
import { Index, Order } from '@ez4/database';

import { getConnectionSchema, isSingleRelationData } from './utils/relation';
import { getWithSchemaValidation, isDynamicObjectField, isDynamicUnionField, validateRecordSchema } from '../utils/schema';
import { getSelectFields, getSelectFilters } from './select';

export type UpdateQueryOptions = {
  flag?: string;
  primaryKey?: string[];
};

export const prepareUpdateQuery = async <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  builder: SqlBuilder,
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  input: Query.UpdateOneInput<S, T> | Query.UpdateManyInput<S, T>,
  options?: UpdateQueryOptions
) => {
  const updateRecord = await getUpdateRecord(builder, input.data, schema, relations, table);
  const hasRecord = !isEmptyObject(updateRecord);

  const updateQuery = hasRecord ? builder.update(schema).only(table).record(updateRecord).returning() : builder.select(schema).from(table);

  const queries: (SqlSelectStatement | SqlUpdateStatement)[] = [];

  let columns = input.select ? Object.keys(input.select) : [];
  let previousQuery: SqlSelectStatement | undefined;
  let reloadKey: string[] | undefined;

  // Every part of the statement reads the tables as they were before it, so a relation the update rewrites in
  // another table would come back stale: the statement returns the keys and the records are read again.
  if (
    input.select &&
    !input.previous &&
    selectsRelation(input.select, relations, table) &&
    rewritesOtherTables(input.data, relations, table)
  ) {
    if (!options?.primaryKey?.length) {
      throw new MissingPrimaryIndexError(table);
    }

    reloadKey = options.primaryKey;
    columns = [...reloadKey];
  }

  if (input.select) {
    if (updateQuery instanceof SqlSelectStatement) {
      const selectFields = reloadKey
        ? getKeyFields(reloadKey)
        : getSelectFields(builder, input.select, input.include, schema, relations, updateQuery, table);

      updateQuery.record(selectFields);

      if (input.lock) {
        updateQuery.lock();
      }
    } else if (input.previous) {
      previousQuery = preparePreviousQuery(builder, table, schema, relations, input.select, input, options?.primaryKey);

      updateQuery.from(previousQuery.reference()).as('U');

      queries.push(previousQuery);
    } else if (reloadKey) {
      // A copy: the relation updates add their columns to the returned list, which must not reach the table index.
      updateQuery.returning([...reloadKey]);
    } else {
      const selectFields = getSelectFields(builder, input.select, input.include, schema, relations, updateQuery, table);

      updateQuery.returning(selectFields);
    }
  }

  const take = 'take' in input && isAnyNumber(input.take) ? input.take : undefined;

  let keyQuery: SqlSelectStatement | undefined;

  if (take !== undefined) {
    if (updateQuery instanceof SqlSelectStatement) {
      updateQuery.take(take);
    } else if (previousQuery) {
      previousQuery.take(take);
    } else {
      keyQuery = prepareKeyQuery(builder, table, schema, relations, input.where, options?.primaryKey).take(take);

      updateQuery.from(keyQuery.reference()).as('U');

      queries.push(keyQuery);
    }
  }

  const postUpdateQueries = await preparePostUpdateRelations(builder, input.data, relations, updateQuery, table);

  queries.push(updateQuery, ...postUpdateQueries);

  // The update writes the records the previous query locked, and no other, so they are the ones reported.
  if (previousQuery) {
    updateQuery.where(getPreviousKeyFilters(previousQuery, options?.primaryKey ?? []));
  } else if (keyQuery) {
    // The filters apply again to the records of the page, so one that another update changed meanwhile and no
    // longer matches is left alone.
    const filters = input.where ? [getSelectFilters(builder, input.where, relations, updateQuery, table)] : [];

    updateQuery.where({ AND: [...filters, getPreviousKeyFilters(keyQuery, options?.primaryKey ?? [])] });
  } else if (input.where) {
    updateQuery.where(getSelectFilters(builder, input.where, relations, updateQuery, table));
  }

  if (input.select && (postUpdateQueries.length > 0 || previousQuery)) {
    const resultQuery = previousQuery ?? updateQuery;

    queries.push(
      builder
        .select()
        .from(resultQuery.reference())
        .columns(...columns)
    );
  }

  if (options?.flag) {
    const resultQuery = queries[queries.length - 1];

    resultQuery.results?.rawColumn(1, options.flag);
    columns.push(options.flag);
  }

  return {
    columns,
    queries,
    reloadKey
  };
};

const selectsRelation = (select: AnyObject, relations: PgRelationRepositoryWithSchema, table: string) => {
  return Object.keys(select).some((fieldKey) => select[fieldKey] && relations[`${table}.${fieldKey}`]);
};

export const rewritesOtherTables = (data: SqlRecord, relations: PgRelationRepositoryWithSchema, table: string) => {
  return Object.values(relations).some((fieldRelation) => {
    const fieldValue = fieldRelation.targetTable === table ? data[fieldRelation.targetAlias] : undefined;

    if (!isSingleRelationData(fieldValue)) {
      return false;
    }

    const [relationValue, , relationInput] = getPostRelationValue(fieldValue, fieldRelation);

    return relationValue !== undefined || relationInput !== undefined;
  });
};

export const getUpdateRecord = async (
  builder: SqlBuilder,
  data: SqlRecord,
  schema: ObjectSchema | UnionSchema,
  relations: PgRelationRepositoryWithSchema,
  path: string
) => {
  const record: SqlRecord = {};

  for (const fieldKey in data) {
    const fieldValue = data[fieldKey];

    if (fieldValue === undefined) {
      continue;
    }

    const fieldPath = `${path}.${fieldKey}`;
    const fieldRelation = relations[fieldPath];

    if (fieldRelation) {
      if (!isSingleRelationData(fieldValue)) {
        throw new InvalidRelationFieldError(fieldPath);
      }

      const [relationValue, relationSchema] = getRelationValue(fieldValue, fieldRelation);

      // Will connect an existing relation.
      if (relationValue !== undefined) {
        const { sourceIndex, targetColumn, targetIndex } = fieldRelation;

        await validateRecordSchema(fieldValue, relationSchema, fieldPath);

        if (isRelationHolder(sourceIndex, targetIndex)) {
          record[targetColumn] = relationValue;
        }
      }

      continue;
    }

    const fieldSchema = getSchemaProperty(schema, fieldKey);

    // Skip values that aren't mapped and isn't part of any dynamic table schema.
    if (!fieldSchema) {
      if (isDynamicUnionField(schema)) {
        record[fieldKey] = fieldValue;
      }

      continue;
    }

    if (!isAnyObject(fieldValue)) {
      record[fieldKey] = await getWithSchemaValidation(fieldValue, fieldSchema, fieldPath);
      continue;
    }

    if (isNumberSchema(fieldSchema)) {
      const atomicResult = await getAtomicNumberOperationUpdate(builder, fieldKey, fieldValue, fieldSchema, fieldPath);

      if (atomicResult) {
        record[fieldKey] = atomicResult;
        continue;
      }
    }

    const atomicOperation = await getAtomicObjectOperationUpdate(builder, fieldKey, fieldValue, fieldSchema, fieldPath);

    if (atomicOperation) {
      const [recordValue] = atomicOperation;

      if (recordValue) {
        record[fieldKey] = recordValue;
      }

      continue;
    }

    if (isDynamicObjectField(fieldSchema)) {
      record[fieldKey] = await getWithSchemaValidation(fieldValue, getOptionalSchema(fieldSchema), fieldPath);
      continue;
    }

    if (isObjectSchema(fieldSchema) || isUnionSchema(fieldSchema)) {
      record[fieldKey] = await getUpdateRecord(builder, fieldValue, getOptionalSchema(fieldSchema), relations, fieldPath);
      continue;
    }

    throw new InvalidFieldSchemaError(fieldPath);
  }

  return record;
};

const preparePostUpdateRelations = async (
  builder: SqlBuilder,
  data: SqlRecord,
  relations: PgRelationRepositoryWithSchema,
  source: SqlSourceWithResults,
  table: string
) => {
  const queries = [];

  const { results } = source;

  for (const relationPath in relations) {
    const fieldRelation = relations[relationPath];

    if (fieldRelation.targetTable !== table) {
      continue;
    }

    const fieldKey = fieldRelation.targetAlias;
    const fieldValue = data[fieldKey];

    if (fieldValue === undefined) {
      continue;
    }

    const fieldPath = `${table}.${fieldKey}`;

    if (!isSingleRelationData(fieldValue)) {
      throw new InvalidRelationFieldError(fieldPath);
    }

    const { sourceTable, sourceIndex, sourceColumn, sourceSchema, targetColumn } = fieldRelation;

    const [relationValue, relationColumn, relationInput] = getPostRelationValue(fieldValue, fieldRelation);

    // Connect an existing relation.
    if (relationValue !== undefined) {
      const relationQuery = builder.update(sourceSchema).from(source.reference()).only(sourceTable).as('T');

      // Disconnect relation.
      if (relationValue === null) {
        if (!results.has(targetColumn)) {
          results.column(targetColumn);
        }

        relationQuery.where({ [sourceColumn]: source.reference(targetColumn) });
        relationQuery.record({ [sourceColumn]: relationValue });

        queries.push(relationQuery);
        continue;
      }

      relationQuery.where({ [relationColumn]: relationValue });

      // Disconnect and Reconnect relation.
      if (sourceIndex === Index.Unique) {
        if (!results.has(targetColumn)) {
          results.column(targetColumn);
        }

        const detachQuery = builder
          .update(sourceSchema)
          .record({ [sourceColumn]: null })
          .where({ [sourceColumn]: source.reference(targetColumn) })
          .returning([source.reference(targetColumn)])
          .from(source.reference())
          .only(sourceTable)
          .as('T');

        relationQuery.record({ [sourceColumn]: detachQuery.reference(targetColumn) });
        relationQuery.from(detachQuery.reference());

        queries.push(detachQuery, relationQuery);
        continue;
      }

      // Connect relation.
      if (!results.has(targetColumn)) {
        results.column(targetColumn);
      }

      relationQuery.record({ [sourceColumn]: source.reference(targetColumn) });

      queries.push(relationQuery);
      continue;
    }

    // Update an existing relation.
    if (relationInput !== undefined) {
      if (!results.has(targetColumn)) {
        results.column(targetColumn);
      }

      const updateRecord = await getUpdateRecord(builder, relationInput, fieldRelation.sourceSchema, relations, table);

      const relationQuery = builder
        .update(sourceSchema)
        .from(source.reference())
        .where({ [sourceColumn]: source.reference(targetColumn) })
        .record(updateRecord)
        .only(sourceTable)
        .as('T');

      queries.push(relationQuery);
    }
  }

  return queries;
};

const getAtomicNumberOperationUpdate = async (
  builder: SqlBuilder,
  fieldKey: string,
  fieldValue: AnyObject,
  fieldSchema: NumberSchema,
  fieldPath: string
) => {
  for (const operation in fieldValue) {
    const value = fieldValue[operation];

    if (isNullish(value)) {
      continue;
    }

    switch (operation) {
      default: {
        throw new InvalidAtomicOperation(`${fieldPath}.${fieldKey}`);
      }

      case 'removeFrom': {
        return undefined;
      }

      case 'increment': {
        await validateRecordSchema(value, fieldSchema, fieldPath);

        return builder.rawOperation('+', value);
      }

      case 'decrement': {
        await validateRecordSchema(value, fieldSchema, fieldPath);

        return builder.rawOperation('-', value);
      }

      case 'multiply': {
        await validateRecordSchema(value, fieldSchema, fieldPath);

        return builder.rawOperation('*', value);
      }

      case 'divide': {
        await validateRecordSchema(value, fieldSchema, fieldPath);

        return builder.rawOperation('/', value);
      }
    }
  }

  return undefined;
};

export const getAtomicObjectOperationUpdate = async (
  builder: SqlBuilder,
  fieldKey: string,
  fieldValue: AnyObject,
  fieldSchema: AnySchema,
  fieldPath: string
) => {
  for (const operation in fieldValue) {
    const value = fieldValue[operation];

    switch (operation) {
      default:
        return undefined;

      case 'replaceWith': {
        if (value !== undefined) {
          return [builder.rawValue(await getWithSchemaValidation(value, fieldSchema, fieldPath))];
        }

        return [];
      }

      case 'removeFrom': {
        if (value) {
          return [builder.rawOperation('#-', `{${fieldKey}}`)];
        }

        return [];
      }
    }
  }

  return undefined;
};

const preparePreviousQuery = <T extends InternalTableMetadata, S extends Query.SelectInput<T>>(
  builder: SqlBuilder,
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  select: Query.StrictSelectInput<S, T>,
  input: Query.UpdateOneInput<S, T> | Query.UpdateManyInput<S, T>,
  primaryKey: string[] | undefined
) => {
  if (!primaryKey?.length) {
    throw new MissingPrimaryIndexError(table);
  }

  const previousQuery = builder.select(schema).from(table).as(builder.alias('R'));
  const selectFields = getSelectFields(builder, select, input.include, schema, relations, previousQuery, table);

  if (input.where) {
    previousQuery.where(getSelectFilters(builder, input.where, relations, previousQuery, table));
  }

  // Locked in key order, so updates over the same records wait for each other instead of deadlocking, and a
  // record another update changed meanwhile is read again, or left out when it no longer matches.
  previousQuery.record(selectFields).order(getKeyOrder(primaryKey)).lock();

  addKeyColumns(previousQuery, primaryKey);

  return previousQuery;
};

export const prepareKeyQuery = (
  builder: SqlBuilder,
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  where: SqlFilters | undefined,
  primaryKey: string[] | undefined
) => {
  if (!primaryKey?.length) {
    throw new MissingPrimaryIndexError(table);
  }

  const keyQuery = builder.select(schema).from(table).as(builder.alias('R'));

  if (where) {
    keyQuery.where(getSelectFilters(builder, where, relations, keyQuery, table));
  }

  addKeyColumns(keyQuery, primaryKey);

  return keyQuery;
};

// The key is read unformatted under an alias of its own, so the statement joins on the column type.
const addKeyColumns = (query: SqlSelectStatement, primaryKey: string[]) => {
  primaryKey.forEach((column, index) => {
    query.rawColumn((source) => mergeSqlAlias(escapeSqlName(column), source?.alias), getKeyAlias(index));
  });
};

export const getPreviousKeyFilters = (previousQuery: SqlSelectStatement, primaryKey: string[]) => {
  const filters: SqlFilters = {};

  primaryKey.forEach((column, index) => {
    filters[column] = previousQuery.reference(getKeyAlias(index));
  });

  return filters;
};

const getKeyOrder = (primaryKey: string[]) => {
  const order: Record<string, Order> = {};

  for (const column of primaryKey) {
    order[column] = Order.Asc;
  }

  return order;
};

const getKeyFields = (primaryKey: string[]) => {
  const fields: Record<string, boolean> = {};

  for (const column of primaryKey) {
    fields[column] = true;
  }

  return fields;
};

export const getKeyAlias = (index: number) => {
  return `__EZ4_KEY_${index}`;
};

// The record holds the relation when the foreign key is its own column, which is where the migration puts it: a unique
// to unique relation is held by the table that declares it, so (re)connecting it rewrites that column instead of the
// unique key of the related records.
const isRelationHolder = (sourceIndex: Index | undefined, targetIndex: Index | undefined) => {
  return sourceIndex === Index.Primary || (sourceIndex === Index.Unique && targetIndex !== Index.Primary);
};

const getRelationValue = (fieldValue: AnyObject, fieldRelation: PgRelationWithSchema) => {
  const { primaryColumn, sourceColumn, sourceIndex, sourceSchema } = fieldRelation;

  const relationColumn = sourceIndex === Index.Primary || sourceIndex === Index.Unique ? sourceColumn : primaryColumn;

  const { [relationColumn]: relationValue } = fieldValue;

  // Will connect an existing relation.
  if (relationValue !== undefined) {
    const relationSchema = getConnectionSchema(sourceSchema, relationColumn);

    return [relationValue, relationSchema];
  }

  // Will update an existing relation.
  const relationSchema = getOptionalSchema(sourceSchema);

  return [, relationSchema];
};

const getPostRelationValue = (fieldValue: AnyObject, fieldRelation: PgRelationWithSchema) => {
  const { primaryColumn, sourceColumn, sourceIndex, targetIndex } = fieldRelation;

  const relationColumn = sourceIndex === Index.Primary || sourceIndex === Index.Unique ? sourceColumn : primaryColumn;

  const { [relationColumn]: relationValue, ...otherFields } = fieldValue;

  // Will connect an existing relation.
  if (isEmptyObject(otherFields)) {
    if (!isRelationHolder(sourceIndex, targetIndex)) {
      return [relationValue, relationColumn];
    }

    return [];
  }

  // Will post-update relations.
  return [, , fieldValue];
};
