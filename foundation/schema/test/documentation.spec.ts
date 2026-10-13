import type { DocumentedSchemaDefinitions } from '@ez4/schema/library';
import type { ObjectSchema } from '@ez4/schema';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';

import { getDocumentationTestSchema, getTestSchema } from './common';

describe('schema documentation', () => {
  const documented: DocumentedSchemaDefinitions = { documentedRequired: true };

  it('assert :: describes by the description tag alone by default', () => {
    deepEqual(getTestSchema('documentation'), {
      type: SchemaType.Object,
      identity: 1,
      properties: {
        commented: { type: SchemaType.String },
        tagged: { type: SchemaType.Number, description: 'Its description tag.' },
        documentedRequired: { type: SchemaType.String, optional: true },
        plain: { type: SchemaType.Boolean }
      }
    } satisfies ObjectSchema);
  });

  it('assert :: describes by the jsdoc text and keeps @required for documentation', () => {
    deepEqual(getDocumentationTestSchema('documentation'), {
      type: SchemaType.Object,
      identity: 1,
      description: 'A model described by its JSDoc.',
      properties: {
        commented: { type: SchemaType.String, description: 'Described by its JSDoc.' },
        tagged: { type: SchemaType.Number, description: 'Its description tag.' },
        documentedRequired: {
          type: SchemaType.String,
          description: 'Missing is allowed, and refused by whoever reads it.',
          optional: true,
          definitions: documented
        },
        plain: { type: SchemaType.Boolean }
      }
    } satisfies ObjectSchema);
  });
});
