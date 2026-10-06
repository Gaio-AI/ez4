import type { AnySchema, ObjectSchema } from '@ez4/schema';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';
import { registerTriggers } from '@ez4/schema/library';

import { getTestSchema } from './common';

const withoutIdentity = (schema: AnySchema | undefined): unknown => {
  return schema && JSON.parse(JSON.stringify(schema), (key, value) => (key === 'identity' ? undefined : value));
};

const getProperties = () => {
  return (getTestSchema('narrowing') as ObjectSchema).properties;
};

const next: AnySchema = {
  type: SchemaType.Array,
  element: {
    type: SchemaType.String,
    nullable: true
  }
};

const narrowedBase = {
  type: SchemaType.Object,
  properties: {
    next,
    kind: {
      type: SchemaType.Enum,
      options: [{ value: 'image' }, { value: 'video' }]
    }
  }
};

const facts = (kind: string, mime: string) => ({
  type: SchemaType.Object,
  properties: {
    next,
    kind: {
      type: SchemaType.String,
      definitions: { value: kind }
    },
    mime: {
      type: SchemaType.String,
      definitions: { value: mime }
    }
  }
});

describe('schema narrowing', () => {
  registerTriggers();

  it('assert :: intersection narrows an enum property', () => {
    deepEqual(withoutIdentity(getProperties().intersection), narrowedBase);
  });

  it('assert :: interface heritage keeps inherited properties and narrows the override', () => {
    deepEqual(withoutIdentity(getProperties().extended), narrowedBase);
  });

  it('assert :: intersection distributes over a union', () => {
    deepEqual(withoutIdentity(getProperties().distributed), {
      type: SchemaType.Union,
      elements: [facts('audio', 'audio/aac'), facts('image', 'image/png')]
    });
  });

  it('assert :: nested intersection narrows an enum to one of its literals', () => {
    deepEqual(withoutIdentity(getProperties().nested), {
      type: SchemaType.Object,
      properties: {
        data: {
          type: SchemaType.Object,
          properties: {
            kind: {
              type: SchemaType.String,
              definitions: { value: 'audio' }
            },
            size: {
              type: SchemaType.Number
            }
          }
        }
      }
    });
  });
});
