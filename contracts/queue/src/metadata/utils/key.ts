import type { ModelProperty } from '@ez4/reflection';
import type { AnySchema } from '@ez4/schema';

import { getPropertyString, getPropertyStringList } from '@ez4/common/library';
import { isObjectSchema, isUnionSchema } from '@ez4/schema';

/**
 * The message fields a `key` property names: one field or a list of them.
 */
export const getKeyFieldsProperty = (member: ModelProperty) => {
  const fieldName = getPropertyString(member);

  return fieldName ? [fieldName] : getPropertyStringList(member);
};

/**
 * The key fields that aren't required fields of every message the schema takes: a message without one of them has
 * no key.
 */
export const getMissingKeyFields = (keyFields: string[], schema: AnySchema) => {
  return keyFields.filter((fieldName) => !isRequiredMessageField(schema, fieldName));
};

const isRequiredMessageField = (schema: AnySchema, fieldName: string): boolean => {
  if (isObjectSchema(schema)) {
    const property = schema.properties[fieldName];

    return !!property && !property.optional && !property.nullable;
  }

  if (isUnionSchema(schema)) {
    return schema.elements.every((element) => isRequiredMessageField(element, fieldName));
  }

  return false;
};
