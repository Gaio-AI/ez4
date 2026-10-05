import type { ReferenceSchema } from '@ez4/schema';
import type { SchemaOutputContext } from '../utils/reference';

import { getIndentedOutput } from '../utils/format';

export const getReferenceSchemaOutput = (schema: ReferenceSchema, context?: SchemaOutputContext) => {
  const pointer = context?.identities.get(schema.identity);

  // A reference always points to an object schema around it, without one it accepts any value.
  if (!pointer) {
    return [];
  }

  // A type next to `$ref` would narrow the referenced schema instead of widening it, so null is another option.
  if (schema.nullable) {
    return ['anyOf:', ...getIndentedOutput([`- $ref: '${pointer}'`, `- type: 'null'`])];
  }

  return [`$ref: '${pointer}'`];
};
