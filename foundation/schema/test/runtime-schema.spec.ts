import type { DocumentedSchemaDefinitions } from '@ez4/schema/library';
import type { ObjectSchema, StringSchemaDefinitions } from '@ez4/schema';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getRuntimeSchema } from '@ez4/schema/library';
import { SchemaType } from '@ez4/schema';

import { getDocumentationTestSchema, getTestSchema } from './common';

describe('runtime schema', () => {
  it('assert :: drops what only documentation reads, at every depth', () => {
    const documented: DocumentedSchemaDefinitions = { documentedRequired: true };
    const documentedWithLength: StringSchemaDefinitions & DocumentedSchemaDefinitions = { documentedRequired: true, minLength: 1 };

    const schema: ObjectSchema = {
      type: SchemaType.Object,
      description: 'A model.',
      definitions: { extensible: true },
      properties: {
        name: {
          type: SchemaType.String,
          description: 'A name.',
          optional: true,
          definitions: documented
        },
        revision: {
          type: SchemaType.String,
          optional: true,
          definitions: documentedWithLength
        },
        tags: {
          type: SchemaType.Array,
          description: 'Some tags.',
          element: { type: SchemaType.String, description: 'A tag.' }
        },
        status: {
          type: SchemaType.Enum,
          options: [{ value: 'on', description: 'On.' }, { value: 'off' }]
        },
        either: {
          type: SchemaType.Union,
          elements: [{ type: SchemaType.Number, description: 'A number.' }, { type: SchemaType.Boolean }]
        }
      },
      additional: {
        property: { type: SchemaType.String, description: 'A key.' },
        value: { type: SchemaType.Number, description: 'A value.' }
      }
    };

    deepEqual(getRuntimeSchema(schema), {
      type: SchemaType.Object,
      definitions: { extensible: true },
      properties: {
        name: { type: SchemaType.String, optional: true },
        revision: { type: SchemaType.String, optional: true, definitions: { minLength: 1 } },
        tags: { type: SchemaType.Array, element: { type: SchemaType.String } },
        status: { type: SchemaType.Enum, options: [{ value: 'on' }, { value: 'off' }] },
        either: {
          type: SchemaType.Union,
          elements: [{ type: SchemaType.Number }, { type: SchemaType.Boolean }]
        }
      },
      additional: {
        property: { type: SchemaType.String },
        value: { type: SchemaType.Number }
      }
    });
  });

  it('assert :: a documented schema runs as the undocumented one', () => {
    const documented = getDocumentationTestSchema('documentation');
    const undocumented = getTestSchema('documentation');

    deepEqual(getRuntimeSchema(documented!), getRuntimeSchema(undocumented!));
  });
});
