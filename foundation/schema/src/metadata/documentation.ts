import type { SchemaDefinitions } from '../types/common';
import type { SchemaContext } from '../types/context';
import type { AnySchema } from '../types/type-any';
import type { ObjectSchemaProperties } from '../types/type-object';

import { createSchemaContext } from '../types/context';
import { SchemaType } from '../types/common';

// What only documentation reads lives here, on the library side: the runtime a function bundles
// stays byte for byte the same whatever the documentation needs.

/**
 * A context whose schemas are documentation too, such as an HTTP contract's: each property and model
 * is described by its JSDoc text when it has no `@description` tag, and a property's `@required` tag
 * is kept (`documentedRequired`). A database or message schema never uses it, so comments never
 * change what its resources store or compare.
 */
export type DocumentationSchemaContext = SchemaContext & {
  documentation: true;
};

/**
 * `documentedRequired`: an optional property documented as required (`@required`), since the code
 * that reads it answers its absence itself.
 */
export type DocumentedSchemaDefinitions = SchemaDefinitions & {
  documentedRequired?: boolean;
};

export const createDocumentationSchemaContext = (): DocumentationSchemaContext => {
  return { ...createSchemaContext(), documentation: true };
};

export const isDocumentationSchemaContext = (context: SchemaContext): context is DocumentationSchemaContext => {
  return 'documentation' in context && context.documentation === true;
};

export const isDocumentedRequired = (schema: AnySchema) => {
  const definitions: DocumentedSchemaDefinitions | undefined = schema.definitions;

  return !!definitions?.documentedRequired;
};

/**
 * The schema without what only documentation reads: descriptions and `documentedRequired`. For a
 * runtime that validates with it, so what a function bundles, and the deploy compares, stays the
 * same whatever the JSDoc of its types says.
 */
export const getRuntimeSchema = <T extends AnySchema>(schema: T): T => {
  const runtimeSchema = { ...schema };

  if ('description' in runtimeSchema) {
    delete runtimeSchema.description;
  }

  if (isDocumentedRequired(runtimeSchema)) {
    const { documentedRequired: _documentedRequired, ...definitions }: DocumentedSchemaDefinitions = runtimeSchema.definitions ?? {};

    if (Object.keys(definitions).length) {
      runtimeSchema.definitions = definitions;
    } else {
      delete runtimeSchema.definitions;
    }
  }

  switch (runtimeSchema.type) {
    case SchemaType.Object: {
      const properties: ObjectSchemaProperties = {};

      for (const name in runtimeSchema.properties) {
        properties[name] = getRuntimeSchema(runtimeSchema.properties[name]);
      }

      runtimeSchema.properties = properties;

      if (runtimeSchema.additional) {
        runtimeSchema.additional = {
          property: getRuntimeSchema(runtimeSchema.additional.property),
          value: getRuntimeSchema(runtimeSchema.additional.value)
        };
      }

      break;
    }

    case SchemaType.Union:
    case SchemaType.Tuple: {
      runtimeSchema.elements = runtimeSchema.elements.map(getRuntimeSchema);
      break;
    }

    case SchemaType.Array: {
      runtimeSchema.element = getRuntimeSchema(runtimeSchema.element);
      break;
    }

    case SchemaType.Enum: {
      runtimeSchema.options = runtimeSchema.options.map(({ value }) => ({ value }));
      break;
    }
  }

  return runtimeSchema;
};
