import type { AnySchema, NamingStyle } from '@ez4/schema';
import type { SchemaOutputContext } from '../utils/reference';

import { SchemaType } from '@ez4/schema';

import { getBooleanSchemaOutput } from './boolean';
import { getNumberSchemaOutput } from './number';
import { getStringSchemaOutput } from './string';
import { getObjectSchemaOutput } from './object';
import { getReferenceSchemaOutput } from './reference';
import { getUnionSchemaOutput } from './union';
import { getArraySchemaOutput } from './array';
import { getTupleSchemaOutput } from './tuple';
import { getEnumSchemaOutput } from './enum';

export const getAnySchemaOutput = (schema: AnySchema, namingStyle?: NamingStyle, context?: SchemaOutputContext): string[] => {
  switch (schema.type) {
    case SchemaType.String:
      return getStringSchemaOutput(schema);

    case SchemaType.Number:
      return getNumberSchemaOutput(schema);

    case SchemaType.Boolean:
      return getBooleanSchemaOutput(schema);

    case SchemaType.Object:
      return getObjectSchemaOutput(schema, namingStyle, context);

    case SchemaType.Reference:
      return getReferenceSchemaOutput(schema, context);

    case SchemaType.Union:
      return getUnionSchemaOutput(schema, namingStyle, context);

    case SchemaType.Array:
      return getArraySchemaOutput(schema, namingStyle, context);

    case SchemaType.Tuple:
      return getTupleSchemaOutput(schema, namingStyle, context);

    case SchemaType.Enum:
      return getEnumSchemaOutput(schema);
  }
};
