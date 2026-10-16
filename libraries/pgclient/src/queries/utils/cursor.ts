import type { AnySchema, ObjectSchema, StringSchema } from '@ez4/schema';
import type { SqlBuilder, SqlOrder } from '@ez4/pgsql';
import type { AnyObject } from '@ez4/utils';

import { InvalidCursorError, MissingFieldSchemaError, UnsupportedCursorError } from '@ez4/pgclient';
import { isBooleanSchema, isEnumSchema, isNullishSchema, isNumberSchema, isStringSchema, SchemaType } from '@ez4/schema';
import { isDate, isDateTime, isTime } from '@ez4/utils';
import { escapeSqlName, mergeSqlAlias } from '@ez4/pgsql';
import { Order } from '@ez4/database';

export type CursorField = {
  column: string;
  alias: string;
};

type CursorColumnType = {
  type: string;
  isValid: (value: string) => boolean;
};

type CursorEntry = [string, string];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER_PATTERN = /^-?\d+$/;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

// Every value is bound as text and cast in the statement, so a driver never detects a date-time and truncates it.
const CursorValueSchema: StringSchema = {
  type: SchemaType.String
};

export const getCursorFields = (order: SqlOrder): CursorField[] => {
  return Object.keys(order).map((column, index) => ({
    alias: `__EZ4_CURSOR_${index}`,
    column
  }));
};

/**
 * Take the cursor out of a page read with one record past its end: that record leaves the page, and the cursor
 * (only when it was there) holds the order values of the last record of the page.
 */
export const takeRecordsCursor = (records: (AnyObject | undefined)[], fields: CursorField[], take: number) => {
  const hasNextPage = records.length > take;

  const lastRecord = hasNextPage ? records[take - 1] : undefined;

  const entries = lastRecord && fields.map(({ column, alias }) => [column, lastRecord[alias]]);

  records.splice(take);

  for (const record of records) {
    for (const { alias } of fields) {
      delete record?.[alias];
    }
  }

  if (entries) {
    return Buffer.from(JSON.stringify(entries)).toString('base64url');
  }

  return undefined;
};

export const getCursorCondition = (
  builder: SqlBuilder,
  cursor: string,
  order: SqlOrder,
  schema: ObjectSchema,
  primaryColumns: string[] | undefined
) => {
  if (!primaryColumns?.length) {
    throw new UnsupportedCursorError('the table has no primary index to make the order unique');
  }

  const columnTypes = Object.keys(order).map((column) => {
    return getCursorColumnType(column, schema, primaryColumns);
  });

  const entries = decodeCursor(cursor);

  const orderColumns = Object.keys(order);

  if (entries.length !== orderColumns.length || entries.some(([column], index) => column !== orderColumns[index])) {
    throw new InvalidCursorError('it was made for another order');
  }

  entries.forEach(([column, value], index) => {
    if (!columnTypes[index].isValid(value)) {
      throw new InvalidCursorError(`value of '${column}' is malformed`);
    }
  });

  const directions = orderColumns.map((column) => order[column]);

  return builder.rawCondition((bind, source) => {
    const columns = orderColumns.map((column) => mergeSqlAlias(escapeSqlName(column), source?.alias));

    const values = entries.map(([, value], index) => `CAST(${bind(value, CursorValueSchema)} AS ${columnTypes[index].type})`);

    const operators = directions.map((direction) => (direction === Order.Asc ? '>' : '<'));

    const [firstOperator] = operators;

    // One row comparison is one range over an index with the order columns.
    if (operators.every((operator) => operator === firstOperator)) {
      return getRowComparison(columns, values, firstOperator);
    }

    const conditions = columns.map((column, index) => {
      const equalities = columns.slice(0, index).map((previous, previousIndex) => `${previous} = ${values[previousIndex]}`);

      if (!equalities.length) {
        return `${column} ${operators[index]} ${values[index]}`;
      }

      return `(${[...equalities, `${column} ${operators[index]} ${values[index]}`].join(' AND ')})`;
    });

    // The expanded form alone can't bound an index scan, so the leading columns in one direction bound it.
    const leadingLength = operators.findIndex((operator) => operator !== firstOperator);

    const leadingBound = getRowComparison(columns.slice(0, leadingLength), values.slice(0, leadingLength), `${firstOperator}=`);

    return `${leadingBound} AND (${conditions.join(' OR ')})`;
  });
};

const getRowComparison = (columns: string[], values: string[], operator: string) => {
  if (columns.length === 1) {
    return `${columns[0]} ${operator} ${values[0]}`;
  }

  return `(${columns.join(', ')}) ${operator} (${values.join(', ')})`;
};

const decodeCursor = (cursor: string): CursorEntry[] => {
  let entries: unknown;

  try {
    entries = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw new InvalidCursorError('it cannot be decoded');
  }

  if (!Array.isArray(entries) || !entries.length || !entries.every(isCursorEntry)) {
    throw new InvalidCursorError('it cannot be decoded');
  }

  return entries;
};

const isCursorEntry = (entry: unknown): entry is CursorEntry => {
  return Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string';
};

const getCursorColumnType = (column: string, schema: ObjectSchema, primaryColumns: string[]): CursorColumnType => {
  const columnSchema = schema.properties[column];

  if (!columnSchema) {
    throw new MissingFieldSchemaError(column);
  }

  // A primary column is never null, even when its field is optional for the insert to fill it in.
  if (isNullishSchema(columnSchema) && !primaryColumns.includes(column)) {
    throw new UnsupportedCursorError(`the order column '${column}' is nullable, and a cursor over null values isn't supported`);
  }

  const columnType = getColumnType(columnSchema);

  if (!columnType) {
    throw new UnsupportedCursorError(`the order column '${column}' has no comparable type`);
  }

  return columnType;
};

const getColumnType = (schema: AnySchema): CursorColumnType | undefined => {
  if (isBooleanSchema(schema)) {
    return {
      type: 'boolean',
      isValid: (value) => value === 'true' || value === 'false'
    };
  }

  if (isNumberSchema(schema)) {
    if (schema.format === 'integer') {
      return {
        type: 'bigint',
        isValid: (value) => INTEGER_PATTERN.test(value)
      };
    }

    return {
      type: 'decimal',
      isValid: (value) => DECIMAL_PATTERN.test(value)
    };
  }

  if (isEnumSchema(schema)) {
    return {
      type: 'text',
      isValid: () => true
    };
  }

  if (!isStringSchema(schema)) {
    return undefined;
  }

  switch (schema.format) {
    case 'uuid':
      return {
        type: 'uuid',
        isValid: (value) => UUID_PATTERN.test(value)
      };

    case 'date-time':
      return {
        type: 'timestamptz',
        isValid: isDateTime
      };

    case 'date':
      return {
        type: 'date',
        isValid: isDate
      };

    case 'time':
      return {
        type: 'time',
        isValid: isTime
      };

    default:
      return {
        type: 'text',
        isValid: () => true
      };
  }
};
