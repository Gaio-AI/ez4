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
  return (getTestSchema('enum-members') as ObjectSchema).properties;
};

const literal = (value: string) => ({
  type: SchemaType.String,
  definitions: { value }
});

const options = (...values: string[]) => ({
  type: SchemaType.Enum,
  options: values.map((value) => ({ value }))
});

const maxText = {
  type: SchemaType.String,
  definitions: { maxLength: 10, trim: true }
};

const upload = (kind: string, mime: object, maxValue: number) => ({
  type: SchemaType.Object,
  properties: {
    next: { type: SchemaType.String },
    kind: literal(kind),
    mime,
    size: {
      type: SchemaType.Number,
      format: 'integer',
      definitions: { minValue: 1, maxValue }
    }
  }
});

describe('schema const enum members', () => {
  registerTriggers();

  it('assert :: a union of members keeps only those members', () => {
    deepEqual(withoutIdentity(getProperties().members), options('image/png', 'image/jpeg'));
  });

  it('assert :: a numeric member is a rich type argument', () => {
    deepEqual(withoutIdentity(getProperties().maxLength), maxText);
  });

  it('assert :: a numeric member reaches a rich type through a generic', () => {
    deepEqual(withoutIdentity(getProperties().generic), {
      type: SchemaType.Object,
      properties: { text: maxText }
    });
  });

  it('assert :: intersection narrows the enum to one member', () => {
    deepEqual(withoutIdentity(getProperties().narrowed), {
      type: SchemaType.Object,
      properties: { kind: literal('audio') }
    });
  });

  it('assert :: intersection narrows the enum to some members', () => {
    deepEqual(withoutIdentity(getProperties().narrowedMany), {
      type: SchemaType.Object,
      properties: { kind: options('video', 'audio') }
    });
  });

  it('assert :: members pick the branches of a distributed union', () => {
    deepEqual(withoutIdentity(getProperties().uploads), {
      type: SchemaType.Union,
      elements: [upload('image', options('image/png', 'image/jpeg'), 100), upload('video', literal('video/mp4'), 200)]
    });
  });
});
