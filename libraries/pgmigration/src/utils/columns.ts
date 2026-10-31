import type { AnySchema, NumberSchema, StringSchema } from '@ez4/schema';

import { isArraySchema, isEnumSchema, isObjectSchema, isScalarSchema, isStringSchema, isTupleSchema, SchemaType } from '@ez4/schema';
import { escapeSqlText } from '@ez4/pgsql';
import { isAnyNumber } from '@ez4/utils';

/**
 * The value the database writes in a timestamp column. The ORM reads a date-time to the millisecond, so a value
 * kept with more precision would compare different from what it reads, and a page cursor would skip records.
 * The statement start is the same for every record a statement writes (unlike the transaction start of `now()`,
 * shared by every statement of a transaction), and it isn't volatile like `clock_timestamp()`, so adding a
 * column with it as the default doesn't rewrite the table.
 */
export const TIMESTAMP_VALUE = `date_trunc('milliseconds', statement_timestamp())`;

export const isOptionalColumn = (schema: AnySchema) => {
  return !!(schema.nullable || schema.optional);
};

/**
 * The default of a column. A timestamp column always defaults to the timestamp, whatever default its schema
 * declares, so a change to the column never drops it.
 */
export const getColumnDefault = (schema: AnySchema, primaryIndex: boolean, timestampColumn = false) => {
  if (timestampColumn) {
    return TIMESTAMP_VALUE;
  }

  if (isScalarSchema(schema) || isObjectSchema(schema) || isArraySchema(schema) || isTupleSchema(schema)) {
    const { definitions } = schema;

    switch (typeof definitions?.default) {
      case 'boolean':
      case 'number':
        return `${definitions.default}`;

      case 'string':
        return escapeSqlText(definitions.default);

      case 'object':
        return escapeSqlText(JSON.stringify(definitions.default));
    }
  }

  if (isEnumSchema(schema)) {
    const { definitions } = schema;

    if (definitions?.default) {
      return escapeSqlText(`${definitions.default}`);
    }
  }

  if (isStringSchema(schema) && primaryIndex) {
    switch (schema.format) {
      case 'date-time':
      case 'date':
      case 'time':
        return 'now()';

      case 'uuid':
        return 'gen_random_uuid()';
    }
  }

  if (isOptionalColumn(schema)) {
    return 'null';
  }

  return undefined;
};

export const getColumnType = (schema: AnySchema, primaryIndex: boolean) => {
  switch (schema.type) {
    case SchemaType.Array:
    case SchemaType.Object:
    case SchemaType.Reference:
    case SchemaType.Union:
    case SchemaType.Tuple:
      return 'jsonb';

    case SchemaType.Boolean:
      return 'boolean';

    case SchemaType.Enum:
      return 'text';

    case SchemaType.Number:
      return getColumNumberType(schema, primaryIndex);

    case SchemaType.String:
      return getColumnTextType(schema);
  }
};

const getColumNumberType = (schema: NumberSchema, primaryIndex: boolean) => {
  if (schema.format === 'integer') {
    return primaryIndex ? 'bigserial' : 'bigint';
  }

  return 'decimal';
};

const getColumnTextType = (schema: StringSchema) => {
  switch (schema.format) {
    case 'uuid':
    case 'time':
    case 'date':
      return schema.format;

    case 'date-time':
      return 'timestamptz';

    default:
      const maxLength = schema.definitions?.maxLength;

      if (isAnyNumber(maxLength)) {
        return `varchar(${maxLength})`;
      }

      return 'text';
  }
};
