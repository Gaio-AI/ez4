import type { AnySchema, ObjectSchema, StringSchema, NumberSchema, ArraySchema, UnionSchema, EnumSchema } from '@ez4/schema';
import { SchemaType } from '@ez4/schema';
import type { JsonSchema } from './schema-types';

export const getJsonSchema = (schema: AnySchema): JsonSchema => {
  switch (schema.type) {
    case SchemaType.String:
      return convertStringSchema(schema as StringSchema);
    case SchemaType.Number:
      return convertNumberSchema(schema as NumberSchema);
    case SchemaType.Boolean:
      return {
        type: 'boolean',
        ...(schema.description ? { description: schema.description } : {})
      };
    case SchemaType.Array:
      return convertArraySchema(schema as ArraySchema);
    case SchemaType.Enum:
      return convertEnumSchema(schema as EnumSchema);
    case SchemaType.Union:
      return convertUnionSchema(schema as UnionSchema);
    case SchemaType.Object:
      return convertObjectSchema(schema as ObjectSchema);
    default:
      return {};
  }
};

const convertStringSchema = (schema: StringSchema): JsonSchema => {
  const output: JsonSchema = { type: 'string' };
  if (schema.description) output.description = schema.description;
  if (schema.format) output.format = schema.format;
  if (schema.definitions?.minLength !== undefined) output.minLength = schema.definitions.minLength;
  if (schema.definitions?.maxLength !== undefined) output.maxLength = schema.definitions.maxLength;
  if (schema.definitions?.pattern) output.pattern = schema.definitions.pattern;
  return output;
};

const convertNumberSchema = (schema: NumberSchema): JsonSchema => {
  const output: JsonSchema = { type: schema.format === 'integer' ? 'integer' : 'number' };
  if (schema.description) output.description = schema.description;
  const min = schema.definitions?.minValue ?? (schema.definitions as Record<string, unknown> | undefined)?.minimum;
  const max = schema.definitions?.maxValue ?? (schema.definitions as Record<string, unknown> | undefined)?.maximum;
  if (min !== undefined) output.minimum = min as number;
  if (max !== undefined) output.maximum = max as number;
  return output;
};

const convertArraySchema = (schema: ArraySchema): JsonSchema => {
  const output: JsonSchema = {
    type: 'array',
    items: getJsonSchema(schema.element)
  };
  if (schema.description) output.description = schema.description;
  return output;
};

const convertEnumSchema = (schema: EnumSchema): JsonSchema => {
  // Support both schema.elements (from test/task) and schema.options (from @ez4/schema EnumSchema AST)
  const anyEnum = schema as unknown as { elements?: (string | number)[]; options?: { value: string | number }[] };
  const values: (string | number)[] = anyEnum.elements ? anyEnum.elements : (anyEnum.options?.map((opt) => opt.value) ?? []);

  const output: JsonSchema = {
    type: 'string',
    enum: values
  };
  if (schema.description) {
    output.description = schema.description;
  }
  return output;
};

const convertUnionSchema = (schema: UnionSchema): JsonSchema => {
  return {
    anyOf: schema.elements.map(getJsonSchema),
    ...(schema.description ? { description: schema.description } : {})
  };
};

const convertObjectSchema = (schema: ObjectSchema): JsonSchema => {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      properties[key] = getJsonSchema(prop);
      if (!prop.optional) {
        required.push(key);
      }
    }
  }

  const output: JsonSchema = {
    type: 'object',
    properties,
    additionalProperties: false
  };

  if (required.length > 0) {
    output.required = required;
  }
  if (schema.description) {
    output.description = schema.description;
  }

  return output;
};
