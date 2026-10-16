import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { SchemaType } from '@ez4/schema';
import type { ObjectSchema } from '@ez4/schema';
import { getJsonSchema } from '@ez4/agent/utils';

describe('agent JSON schema generator', () => {
  it('assert :: converts simple object schema with required and optional properties', () => {
    const ez4Schema: ObjectSchema = {
      type: SchemaType.Object,
      properties: {
        issueId: {
          type: SchemaType.String,
          description: 'The Linear issue ID',
          definitions: { minLength: 1 }
        },
        round: {
          type: SchemaType.Number,
          optional: true,
          description: 'Attempt counter'
        }
      }
    };

    const result = getJsonSchema(ez4Schema);

    deepEqual(result, {
      type: 'object',
      properties: {
        issueId: {
          type: SchemaType.String,
          description: 'The Linear issue ID',
          minLength: 1
        },
        round: {
          type: 'number',
          description: 'Attempt counter'
        }
      },
      required: ['issueId'],
      additionalProperties: false
    });
  });

  it('assert :: converts union, enum, array and nested object schemas', () => {
    const ez4Schema = {
      type: SchemaType.Object,
      properties: {
        status: {
          type: SchemaType.Enum,
          elements: ['ready', 'blocked']
        },
        tags: {
          type: SchemaType.Array,
          element: { type: SchemaType.String }
        }
      }
    } as unknown as ObjectSchema;

    const result = getJsonSchema(ez4Schema);

    deepEqual(result, {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['ready', 'blocked']
        },
        tags: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['status', 'tags'],
      additionalProperties: false
    });
  });
});
