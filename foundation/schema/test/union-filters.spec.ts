import type { AnySchema, ObjectSchema } from '@ez4/schema';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerTriggers } from '@ez4/schema/library';

import { getTestSchema, testFile } from './common';

const withoutIdentity = (schema: AnySchema | undefined): unknown => {
  return schema && JSON.parse(JSON.stringify(schema), (key, value) => (key === 'identity' ? undefined : value));
};

const getFilterProperties = () => {
  return (getTestSchema('union-filters') as ObjectSchema).properties;
};

const getNestedFilters = (schema: AnySchema | undefined) => {
  return (schema as ObjectSchema).properties.filters;
};

describe('schema union filters', () => {
  registerTriggers();

  it('assert :: union of objects inside base64 array', () => testFile('union-filters'));

  it('assert :: generic filter fields produce the hand-written union', () => {
    const { handwritten, generic } = getFilterProperties();

    deepEqual(withoutIdentity(generic), withoutIdentity(handwritten));
  });

  it('assert :: indexed access filters produce the hand-written union', () => {
    const { handwritten, indexed } = getFilterProperties();

    deepEqual(withoutIdentity(getNestedFilters(indexed)), withoutIdentity({ ...handwritten, optional: true }));
  });

  it('assert :: conditional filters produce the hand-written union', () => {
    const { handwritten, conditional } = getFilterProperties();

    deepEqual(withoutIdentity(getNestedFilters(conditional)), withoutIdentity({ ...handwritten, optional: true }));
  });
});
