import type { ReferenceSchema } from '@ez4/schema';
import type { SchemaOutputContext } from '../utils/reference';

export const getReferenceSchemaOutput = (schema: ReferenceSchema, context?: SchemaOutputContext) => {
  const pointer = context?.identities.get(schema.identity);

  // A reference always points to an object schema around it, without one it accepts any value.
  if (!pointer) {
    return [];
  }

  return [`$ref: '${pointer}'`];
};
