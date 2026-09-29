import type { AnySchema, ObjectSchema } from '@ez4/schema';

import { deepEqual, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerTriggers } from '@ez4/schema/library';

import { getTestSchema } from './common';

// The checker orders union members by type id, so membership (not order) is what must match.
const normalize = (schema: AnySchema | undefined): unknown => {
  return (
    schema &&
    JSON.parse(JSON.stringify(schema), (key, value) => {
      if (key === 'identity') {
        return undefined;
      }

      if (value?.type === 'union' || value?.type === 'enum') {
        const members = value.type === 'union' ? 'elements' : 'options';

        return { ...value, [members]: [...value[members]].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
      }

      return value;
    })
  );
};

const getProperties = () => {
  const { properties } = getTestSchema('checker-fallback') as ObjectSchema;

  return {
    generic: (properties.generic as ObjectSchema).properties,
    direct: (properties.direct as ObjectSchema).properties,
    expected: (properties.expected as ObjectSchema).properties
  };
};

describe('schema checker fallback', () => {
  registerTriggers();

  const { generic, direct, expected } = getProperties();

  const genericKeys = [
    'unwrap',
    'isShape',
    'elem',
    'optionals',
    'record',
    'keys',
    'index',
    'literalIndex',
    'nonNull',
    'nullable',
    'list',
    'shape'
  ];
  const directKeys = [...genericKeys, 'colors', 'template', 'prefixed'];

  for (const key of genericKeys) {
    it(`assert :: ${key} through a generic instantiation matches the hand-written type`, () => {
      deepEqual(normalize(generic[key]), normalize(expected[key]));
    });
  }

  for (const key of directKeys) {
    it(`assert :: ${key} used directly matches the hand-written type`, () => {
      deepEqual(normalize(direct[key]), normalize(expected[key]));
    });
  }

  it('assert :: unrepresentable pattern template and index signature stay dropped', () => {
    ok(!('pattern' in direct));
    ok(!('dictionary' in direct));
  });
});
