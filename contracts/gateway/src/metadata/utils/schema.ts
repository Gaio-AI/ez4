import type { ReflectionTypes, TypeIntersection, TypeModel, TypeObject } from '@ez4/reflection';

import { createDocumentationSchemaContext, getIntersectionSchema, getObjectSchema } from '@ez4/schema/library';
import { isObjectSchema } from '@ez4/schema';

// A route's request and response schemas are its documentation too: properties are described by
// their JSDoc, and `@required` marks what the handler refuses missing on its own.

export const getSchemaFromIntersection = (type: TypeObject | TypeModel | TypeIntersection, reflection: ReflectionTypes) => {
  const schema = getIntersectionSchema(type, reflection, createDocumentationSchemaContext());

  if (schema && isObjectSchema(schema)) {
    return schema;
  }

  return undefined;
};

export const getSchemaFromObject = (type: TypeObject | TypeModel | TypeIntersection, reflection: ReflectionTypes) => {
  const schema = getObjectSchema(type, reflection, createDocumentationSchemaContext());

  if (schema && isObjectSchema(schema)) {
    return schema;
  }

  return undefined;
};
