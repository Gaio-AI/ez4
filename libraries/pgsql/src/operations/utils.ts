import type { AnySchema } from '@ez4/schema';
import type { SqlOperationContext, SqlOperationFlags } from './types';

import { SchemaType } from '@ez4/schema';

import { SqlColumnReference } from '../common/reference';
import { escapeSqlData } from '../utils/escape';
import { SqlRawValue } from '../common/raw';

export const getOperandValue = (schema: AnySchema | undefined, operand: unknown, context: SqlOperationContext, encode?: boolean) => {
  const { source, variables, references, options } = context;

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
    return variables.push(operand), field;
  }

  const preparedValue = options.onPrepareVariable(operand, {
    json: isJsonOperand(schema, context, encode),
    schema,
    index
  });

  variables.push(preparedValue);

  return field;
};

export const getOperandArray = (schema: AnySchema | undefined, operands: unknown[], context: SqlOperationContext) => {
  const { variables, references, options } = context;

  if (!references || !options.onPrepareArray) {
    return undefined;
  }

  // SQL written by the caller (raw values and column references) can't go inside a bound array.
  if (operands.some((operand) => operand instanceof SqlRawValue || operand instanceof SqlColumnReference)) {
    return undefined;
  }

  // A JSON value compares as JSON, which a bound array of plain values doesn't, so each one is bound on its own.
  if (isJsonOperand(schema, context)) {
    return undefined;
  }

  const index = references.counter;

  const preparedArray = options.onPrepareArray(operands, {
    schema,
    index
  });

  if (preparedArray === undefined) {
    return undefined;
  }

  references.counter++;

  variables.push(preparedArray);

  return `:${index}`;
};

export const getOperandPattern = (schema: AnySchema | undefined, operand: unknown, context: SqlOperationContext) => {
  // Text matches literally, so its pattern characters are escaped with the backslash, LIKE's default escape.
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

// Inside a JSON column, a field without a schema is read as JSON (`"column"['field']`), so its operand must be
// JSON too: compared as text or as a number, Postgres has no operator for it.
const isJsonOperand = (schema: AnySchema | undefined, context: SqlOperationContext, encode?: boolean) => {
  return !!context.path && (!!encode || !schema);
};
