import type { AnySchema } from '@ez4/schema';
import type { SqlSource } from '@ez4/pgsql';

import { escapeSqlName, mergeSqlAlias } from '@ez4/pgsql';
import { isStringSchema } from '@ez4/schema';

const ColumnFormats: Record<string, string> = {
  ['date-time']: `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`,
  ['time']: `'HH24:MI:SS.MS"Z"'`,
  ['date']: `'YYYY-MM-DD'`
};

const CursorFormats: Record<string, string> = {
  ['date-time']: `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`,
  ['time']: `'HH24:MI:SS.US"Z"'`,
  ['date']: `'YYYY-MM-DD'`
};

export const getFormattedColumn = (column: string, schema: AnySchema) => {
  const columnMask = getColumnMask(schema);

  if (columnMask) {
    const columnName = escapeSqlName(column);

    return (source?: SqlSource) => {
      return formatColumn(columnName, columnMask, source);
    };
  }

  return column;
};

export const getExpressionFormatter = (schema: AnySchema) => {
  const columnMask = getColumnMask(schema);

  if (columnMask) {
    return (expression: string) => {
      return `to_char(${expression}, ${columnMask})`;
    };
  }

  return undefined;
};

const getColumnMask = (schema: AnySchema) => {
  if (isStringSchema(schema) && schema.format) {
    return ColumnFormats[schema.format];
  }

  return undefined;
};

/**
 * Get the column value as text at full precision, as a cursor keeps it. Date-times are read in UTC whatever the
 * session time zone, so the value goes back into the statement as the same instant.
 */
export const getCursorColumn = (column: string, schema: AnySchema) => {
  const columnName = escapeSqlName(column);

  const columnFormat = isStringSchema(schema) ? schema.format : undefined;

  return (source?: SqlSource) => {
    const columnPath = mergeSqlAlias(columnName, source?.alias);

    switch (columnFormat) {
      case 'date-time':
        return `to_char(${columnPath} AT TIME ZONE 'UTC', ${CursorFormats['date-time']})`;

      case 'time':
      case 'date':
        return `to_char(${columnPath}, ${CursorFormats[columnFormat]})`;

      default:
        return `${columnPath}::text`;
    }
  };
};

const formatColumn = (columnName: string, columnMask: string, source?: SqlSource) => {
  const columnPath = mergeSqlAlias(columnName, source?.alias);
  const expression = `to_char(${columnPath}, ${columnMask})`;

  return expression;
};
