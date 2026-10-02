import type { AnySchema } from '@ez4/schema';
import type { SqlOperationContext, SqlOperationFlags } from './types';

import { SchemaType } from '@ez4/schema';

import { SqlColumnReference } from '../common/reference';
import { escapeSqlData } from '../utils/escape';
import { SqlRawValue } from '../common/raw';

export const getOperandValue = (schema: AnySchema | undefined, operand: unknown, context: SqlOperationContext, encode?: boolean) => {
  const { source, variables, references, options, path } = context;

  if (operand instanceof SqlRawValue) {
    return operand.build(source);
  }

  if (operand instanceof SqlColumnReference) {
    return operand.build();
  }

  if (!references) {
    return escapeSqlData(operand);
  }

  const index = references.counter++;
  const field = `:${index}`;

  if (!options.onPrepareVariable) {
    return (variables.push(operand), field);
  }

  const preparedValue = options.onPrepareVariable(operand, {
    json: encode && !!path,
    schema,
    index
  });

  variables.push(preparedValue);

  return field;
};

export const getOperandPattern = (schema: AnySchema | undefined, operand: unknown, context: SqlOperationContext) => {
  // Text matches literally, so its pattern characters are escaped with the backslash the LIKE operations declare in ESCAPE.
  // Raw values and column references are SQL written by the caller and go into the pattern as they are.
  if (typeof operand === 'string') {
    return getOperandValue(schema, operand.replaceAll(/[\\%_]/g, '\\$&'), context);
  }

  return getOperandValue(schema, operand, context);
};

export const getOperandColumn = (schema: AnySchema | undefined, column: string, context: SqlOperationContext) => {
  const isJsonColumn = !!context.path;

  if (!isJsonColumn) {
    return column;
  }

  switch (schema?.type) {
    case SchemaType.Boolean: {
      return `(${column})::bool`;
    }

    case SchemaType.Number: {
      if (schema.format === 'integer') {
        return `(${column})::int`;
      }

      return `(${column})::dec`;
    }

    case SchemaType.String: {
      if (schema.format === 'date-time') {
        return `(${column})::timestamptz`;
      }

      if (schema.format === 'date') {
        return `(${column})::date`;
      }

      if (schema.format === 'time') {
        return `(${column})::time`;
      }

      break;
    }
  }

  return column;
};

export const getOperandFunction = (column: string, flags: SqlOperationFlags) => {
  if (flags.count) {
    return `COUNT(${column})`;
  }

  if (flags.insensitive) {
    return `LOWER(${column})`;
  }

  return column;
};
