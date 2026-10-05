import type { AnySchema, ReferenceSchema } from '@ez4/schema';

import { getMultilineOutput } from '../utils/format';

export const getCommonSchemaOutput = (schema: Exclude<AnySchema, ReferenceSchema>) => {
  const output = [];

  if (schema.description) {
    output.push(`description: "${getMultilineOutput(schema.description)}"`);
  }

  return output;
};

/**
 * OpenAPI 3.1 has no `nullable` keyword: a nullable schema lists `null` as one more type.
 */
export const getTypeOutput = (type: string, schema: AnySchema) => {
  return schema.nullable ? `type: [${type}, 'null']` : `type: ${type}`;
};

/**
 * A constant restricts the value to itself, so a nullable constant lists `null` as one more value.
 */
export const getConstantOutput = (value: string, schema: AnySchema) => {
  return schema.nullable ? `enum: [${value}, null]` : `enum: [${value}]`;
};
