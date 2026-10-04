import type { AnySchema, ObjectSchema, UnionSchema } from '@ez4/schema';
import type { SqlBuilderOptions, SqlBuilderReferences } from '../builder';
import type { SqlSource } from '../common/source';
import type { SqlRecord } from '../common/types';

import { getSchemaProperty, isDynamicObjectSchema, isNullishSchema, isObjectSchema, isUnionSchema, SchemaType } from '@ez4/schema';
import { isPlainObject } from '@ez4/utils';

import { SqlRaw, SqlRawOperation } from '../common/raw';
import { SqlColumnReference } from '../common/reference';
import { mergeSqlAlias, mergeSqlJsonPath, mergeSqlPath } from '../utils/merge';
import { InvalidAtomicOperation } from '../errors/operations';
import { SqlSelectStatement } from '../statements/select';
import { escapeSqlText } from '../utils/escape';

// A key is always plain text: left to the driver's detection, a key shaped like a date or a UUID would be bound
// as one and come back rewritten.
const jsonKeySchema: AnySchema = {
  type: SchemaType.String
};

export type SqlUpdateContext = {
  options: SqlBuilderOptions;
  references: SqlBuilderReferences;
  variables: unknown[];
  coalesce?: boolean;
  parent?: string;
  depth?: number;
};

export const getUpdateColumns = (
  source: SqlSource,
  record: SqlRecord,
  schema: ObjectSchema | UnionSchema | undefined,
  context: SqlUpdateContext
): string[] => {
  const { variables, references, options, coalesce, parent, depth = 0 } = context;

  const columns = [];

  const json = !!parent;

  // Inside a JSON column the field name is a key that can come straight from data, so it's bound as a variable
  // and never written into the statement.
  const bindJsonKey = (fieldName: string) => {
    const keyIndex = references.counter++;

    if (options.onPrepareVariable) {
      variables.push(options.onPrepareVariable(fieldName, { schema: jsonKeySchema, index: keyIndex }));
    } else {
      variables.push(fieldName);
    }

    return `:${keyIndex}`;
  };

  for (const fieldName in record) {
    const value = record[fieldName];

    if (value === undefined) {
      continue;
    }

    if (value instanceof SqlRawOperation && isJsonRemoveOperator(value.operator)) {
      columns.push(`${value.operator} ${escapeSqlText(`${value.build()}`)}`);
      continue;
    }

    const fieldKey = json ? bindJsonKey(fieldName) : undefined;

    const pushUpdate = (fieldValue: string) => {
      if (depth <= 1 && !coalesce) {
        columns.push(`${mergeSqlPath(fieldName, parent, fieldKey)} = ${fieldValue}`);
      } else {
        columns.push(`${fieldKey}, ${fieldValue}`);
      }
    };

    if (value === null && !json) {
      pushUpdate('null');
      continue;
    }

    if (value instanceof SqlColumnReference) {
      pushUpdate(value.build());
      continue;
    }

    if (value instanceof SqlSelectStatement) {
      const [selectStatement, selectVariables] = value.build();

      pushUpdate(`(${selectStatement})`);
      variables.push(...selectVariables);

      continue;
    }

    const fieldSchema = schema && getSchemaProperty(schema, fieldName);

    if (isPlainObject(value)) {
      const innerSchema = fieldSchema && (isObjectSchema(fieldSchema) || isUnionSchema(fieldSchema)) ? fieldSchema : undefined;
      const mustCombine = coalesce || !fieldSchema || (innerSchema && isDynamicObjectColumn(innerSchema));

      const columnName = mergeSqlPath(fieldName, parent, fieldKey);
      const columnPath = mergeSqlAlias(columnName, source.alias);

      const jsonValue = getUpdateColumns(source, value, innerSchema, {
        ...context,
        coalesce: mustCombine,
        parent: columnName,
        depth: depth + 1
      });

      const [removals, additions] = jsonValue.reduce<[string[], string[]]>(
        (values, value) => (values[isJsonRemoveOperator(value) ? 0 : 1].push(value), values),
        [[], []]
      );

      const expression = [];

      if (mustCombine) {
        expression.push(`COALESCE(${columnPath}, '{}'::jsonb)`, ...removals);
      } else if (removals.length || depth > 0) {
        expression.push(columnPath, ...removals);
      }

      if (additions.length && (mustCombine || depth > 0)) {
        expression.push(`|| jsonb_build_object(${additions.join(', ')})`);
      }

      if (expression.length) {
        pushUpdate(expression.join(' '));
      }

      if (!mustCombine && depth === 0) {
        columns.push(...additions);
      }

      continue;
    }

    const fieldIndex = references.counter++;

    if (!(value instanceof SqlRawOperation)) {
      pushUpdate(`:${fieldIndex}`);
    } else {
      const columnName = mergeSqlJsonPath(fieldName, parent, true, fieldKey);
      const columnPath = mergeSqlAlias(columnName, source.alias);

      if (!json) {
        pushUpdate(`(${columnPath} ${value.operator} :${fieldIndex})`);
      } else {
        const lhsOperand = getOperandColumn(fieldSchema, fieldName, coalesce ? getOperandCoalesce(fieldSchema, columnPath) : columnPath);
        const rhsOperand = getOperandColumn(fieldSchema, fieldName, `:${fieldIndex}`);

        pushUpdate(`(${lhsOperand} ${value.operator} ${rhsOperand})::text::jsonb`);
      }
    }

    const fieldValue = value instanceof SqlRaw ? value.build(source) : value;

    if (options.onPrepareVariable) {
      variables.push(options.onPrepareVariable(fieldValue, { schema: fieldSchema, index: fieldIndex, json }));
      continue;
    }

    variables.push(fieldValue);
  }

  return columns;
};

const isDynamicObjectColumn = (schema: ObjectSchema | UnionSchema): boolean => {
  return isNullishSchema(schema) || (isObjectSchema(schema) && isDynamicObjectSchema(schema));
};

const isJsonRemoveOperator = (operand: string) => {
  return operand.startsWith('#-');
};

const getOperandColumn = (schema: AnySchema | undefined, fieldName: string, fieldExpression: string) => {
  if (schema?.type !== SchemaType.Number) {
    throw new InvalidAtomicOperation(fieldName);
  }

  if (schema.format === 'integer') {
    return `(${fieldExpression})::int`;
  }

  return `(${fieldExpression})::dec`;
};

const getOperandCoalesce = (schema: AnySchema | undefined, columnName: string) => {
  if (schema?.type === SchemaType.Number) {
    const defaultValue = schema.definitions?.value ?? schema.definitions?.default ?? schema.definitions?.minValue ?? 0;

    return `COALESCE(${columnName}, '${defaultValue}')`;
  }

  return columnName;
};
