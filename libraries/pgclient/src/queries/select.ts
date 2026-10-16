import type { SqlBuilder, SqlFilters, SqlJsonColumnRecord, SqlOrder, SqlSource } from '@ez4/pgsql';
import type { ObjectSchema } from '@ez4/schema';
import type { AnyObject } from '@ez4/utils';
import type { Order, Query } from '@ez4/database';
import type { PgRelationRepositoryWithSchema } from '../types/repository';
import type { InternalTableMetadata } from '../types/table';

import { isAnyNumber, isAnyObject, isEmptyObject } from '@ez4/utils';
import { InvalidRelationFieldError, MissingFieldSchemaError } from '@ez4/pgclient';
import { isObjectSchema } from '@ez4/schema';
import { Index } from '@ez4/database';

import { getCursorColumn, getFormattedColumn } from './utils/formats';
import { getCursorCondition, getCursorFields } from './utils/cursor';

export type SelectQueryOptions = {
  /**
   * Primary index columns of the table, which make the order of a page unique.
   */
  primaryColumns?: string[];
};

export const prepareSelectQuery = <T extends InternalTableMetadata, S extends Query.SelectInput<T>, C extends boolean>(
  builder: SqlBuilder,
  table: string,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  input: Query.FindOneInput<S, T> | Query.FindManyInput<S, C, T>,
  options?: SelectQueryOptions
) => {
  const query = builder.select(schema).from(table);
  const record = getSelectFields(builder, input.select, input.include, schema, relations, query, table);

  const order = 'order' in input ? getPageOrder(input, options?.primaryColumns) : undefined;

  const cursorFields =
    'take' in input && isAnyNumber(input.take) && input.take > 0 && order && !isEmptyObject(order)
      ? assignCursorFields(record, order, schema, query)
      : undefined;

  query.record(record);

  const filters = input.where && getSelectFilters(builder, input.where, relations, query, table);

  if ('cursor' in input && input.cursor !== undefined) {
    const cursorCondition = getCursorCondition(builder, input.cursor, order ?? {}, schema, options?.primaryColumns);

    query.where({
      ...filters,
      AND: [...(filters?.AND ?? []), cursorCondition]
    });
  } else if (filters) {
    query.where(filters);
  }

  if (input.lock) {
    query.lock();
  }

  if (order) {
    query.order(order);

    // An unqualified ORDER BY name binds to the output column, which is the formatted text for date and
    // time fields, so the source gets an alias and the order references the table column and its index.
    if (!isEmptyObject(order) && !query.alias) {
      query.as(builder.alias('R'));
    }
  }

  if ('skip' in input && isAnyNumber(input.skip)) {
    query.skip(input.skip);
  }

  if ('take' in input && isAnyNumber(input.take)) {
    // A page with a cursor reads one record past its end, which is only there to tell a next page exists.
    query.take(cursorFields ? input.take + 1 : input.take);
  }

  return {
    columns: Object.keys(record),
    cursorFields,
    query
  };
};

/**
 * Get the order of a page: the primary columns missing from a non-empty order are appended to it in the direction
 * of its last column, so rows that tie on the order keep one position from a page to the next.
 */
export const getTiebreakOrder = (order: SqlOrder, primaryColumns: string[] | undefined) => {
  const pageOrder: SqlOrder = {};

  let lastDirection: Order | undefined;

  for (const column in order) {
    const direction = order[column];

    if (direction) {
      pageOrder[column] = lastDirection = direction;
    }
  }

  if (!lastDirection || !primaryColumns) {
    return pageOrder;
  }

  for (const column of primaryColumns) {
    pageOrder[column] ??= lastDirection;
  }

  return pageOrder;
};

const getPageOrder = <T extends InternalTableMetadata, S extends AnyObject, C extends boolean>(
  input: Query.FindManyInput<S, C, T>,
  primaryColumns: string[] | undefined
) => {
  const { order } = input;

  const isPage = ('take' in input && isAnyNumber(input.take)) || ('skip' in input && isAnyNumber(input.skip)) || input.cursor !== undefined;

  if (!order || !isPage) {
    return order;
  }

  return getTiebreakOrder(order, primaryColumns);
};

// The cursor reads the last record's order values at full precision, in columns that never reach the records.
const assignCursorFields = (record: SqlJsonColumnRecord, order: SqlOrder, schema: ObjectSchema, source: SqlSource) => {
  const cursorFields = getCursorFields(order);

  for (const { column, alias } of cursorFields) {
    const columnSchema = schema.properties[column];

    if (!columnSchema) {
      throw new MissingFieldSchemaError(column);
    }

    record[alias] = source.reference(getCursorColumn(column, columnSchema), alias);
  }

  return cursorFields;
};

export const getSelectFields = <T extends InternalTableMetadata, S extends AnyObject>(
  builder: SqlBuilder,
  fields: Query.StrictSelectInput<S, T>,
  include: Query.StrictIncludeInput<S, T> | undefined | null,
  schema: ObjectSchema,
  relations: PgRelationRepositoryWithSchema,
  source: SqlSource,
  path: string,
  json?: boolean
) => {
  const allFields: Record<string, boolean> = isEmptyObject(fields) ? getDefaultSelectFields(schema) : fields;

  const output: SqlJsonColumnRecord = {};

  for (const fieldKey in allFields) {
    const fieldValue = allFields[fieldKey];

    if (!fieldValue) {
      continue;
    }

    const fieldPath = `${path}.${fieldKey}`;

    const fieldRelation = relations[fieldPath];

    if (fieldRelation) {
      const { sourceTable, sourceColumn, sourceSchema, sourceIndex, targetColumn, primaryColumn } = fieldRelation;

      const relationFields = fieldValue === true ? getDefaultSelectFields(sourceSchema) : fieldValue;

      if (!isAnyObject(relationFields)) {
        throw new InvalidRelationFieldError(fieldPath);
      }

      const relationIncludes = include && include[fieldKey];

      if (!source.alias) {
        source.as(builder.alias('R'));
      }

      const relationQuery = builder.select(sourceSchema).from(sourceTable);

      relationQuery.where({
        ...(relationIncludes?.where && getSelectFilters(builder, relationIncludes.where, relations, relationQuery, sourceTable)),
        [sourceColumn]: source.reference(targetColumn)
      });

      if (sourceIndex === Index.Primary || sourceIndex === Index.Unique) {
        const record = getSelectFields(builder, relationFields, null, sourceSchema, relations, relationQuery, sourceTable, true);

        relationQuery.take(1).objectColumn(record);

        output[fieldKey] = relationQuery;
        continue;
      }

      // The aggregate orders by the table columns, so the order fields stay out of each related record.
      if (!relationIncludes || (!('skip' in relationIncludes) && !('take' in relationIncludes))) {
        const record = getSelectFields(builder, relationFields, null, sourceSchema, relations, relationQuery, sourceTable, true);

        relationQuery.arrayColumn(record, {
          order: relationIncludes?.order
        });

        output[fieldKey] = relationQuery;
        continue;
      }

      const record = getSelectFields(builder, relationFields, null, sourceSchema, relations, relationQuery, sourceTable);

      const relationOrder = relationIncludes.order && getTiebreakOrder(relationIncludes.order, primaryColumn ? [primaryColumn] : []);

      // The page is aggregated from a subquery, which has to return the order fields for the aggregate to sort
      // by them, while each related record keeps only the selected fields.
      if (relationOrder) {
        assignExtraSelectFields(record, relationOrder);

        relationQuery.order(relationOrder);
      }

      relationQuery.record(record);

      if ('skip' in relationIncludes) {
        relationQuery.skip(relationIncludes.skip);
      }

      if ('take' in relationIncludes) {
        relationQuery.take(relationIncludes.take);
      }

      const wrapQuery = builder.select().from(relationQuery);

      wrapQuery.arrayColumn(relationFields, {
        order: relationOrder
      });

      output[fieldKey] = wrapQuery;
      continue;
    }

    const fieldSchema = schema.properties[fieldKey];

    if (!fieldSchema) {
      throw new MissingFieldSchemaError(fieldPath);
    }

    if (isObjectSchema(fieldSchema)) {
      output[fieldKey] = fieldValue;
      continue;
    }

    const fieldColumn = getFormattedColumn(fieldKey, fieldSchema);

    if (fieldColumn instanceof Function) {
      output[fieldKey] = source.reference(fieldColumn, !json ? fieldKey : undefined);
    } else {
      output[fieldKey] = true;
    }
  }

  return output;
};

export const getSelectFilters = (
  builder: SqlBuilder,
  filters: SqlFilters,
  relations: PgRelationRepositoryWithSchema,
  source: SqlSource,
  path: string
) => {
  const result: SqlFilters = {};

  const missingRelations: SqlFilters[] = [];

  for (const filterKey in filters) {
    if (filters[filterKey] === undefined) {
      continue;
    }

    switch (filterKey) {
      case 'OR':
      case 'AND':
        result[filterKey] = filters[filterKey].map((operation: SqlFilters) => {
          return getSelectFilters(builder, operation, relations, source, path);
        });
        break;

      case 'NOT':
        result[filterKey] = getSelectFilters(builder, filters[filterKey], relations, source, path);
        break;

      default:
        const relationFilters = filters[filterKey];

        const filterPath = `${path}.${filterKey}`;
        const fieldRelation = relations[filterPath];

        if (!fieldRelation) {
          result[filterKey] = relationFilters;
          continue;
        }

        const { sourceTable, sourceColumn, sourceSchema, targetColumn } = fieldRelation;

        // Each level has its own alias, so the reference to the level above binds to it and not to an inner level.
        const relationQuery = builder.select(sourceSchema).from(sourceTable).rawColumn(1).as(builder.alias('T'));

        if (!source.alias) {
          source.as(builder.alias('R'));
        }

        relationQuery.where({
          ...(relationFilters && getSelectFilters(builder, relationFilters, relations, relationQuery, sourceTable)),
          [sourceColumn]: source.reference(targetColumn)
        });

        // A null filter asks for the records without a related one.
        if (relationFilters === null) {
          missingRelations.push({ NOT: { [filterKey]: relationQuery } });
          continue;
        }

        result[filterKey] = relationQuery;
    }
  }

  // Joined through AND after the loop: a NOT of their own would replace the one the filters carry, and the
  // filters' own AND is only built inside the loop.
  if (missingRelations.length) {
    result.AND = [...(result.AND ?? []), ...missingRelations];
  }

  return result;
};

export const getDefaultSelectFields = (schema: ObjectSchema) => {
  const fields: Record<string, boolean> = {};

  for (const fieldKey in schema.properties) {
    fields[fieldKey] = true;
  }

  return fields;
};

const assignExtraSelectFields = (record: SqlJsonColumnRecord, fields: Record<string, unknown>) => {
  for (const fieldName in fields) {
    if (!record[fieldName]) {
      record[fieldName] = true;
    }
  }
};
