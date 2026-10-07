import type { AnySchema, ArraySchema, ObjectSchema } from '@ez4/schema';

import { equal, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';
import { base64Encode } from '@ez4/utils';
import {
  validate,
  ExpectedDateTimeFormatError,
  ExpectedNumberTypeError,
  ExpectedStringTypeError,
  ExpectedTupleTypeError,
  ExpectedUUIDTypeError,
  UnexpectedEnumValueError,
  UnexpectedPropertiesError,
  UnexpectedStringError
} from '@ez4/validator';

const literal = (value: string): AnySchema => ({ type: SchemaType.String, definitions: { value } });

const options = (...values: string[]): AnySchema => ({ type: SchemaType.Enum, options: values.map((value) => ({ value })) });

const tuple = (...elements: AnySchema[]): AnySchema => ({ type: SchemaType.Tuple, elements });

const dateTime: AnySchema = { type: SchemaType.String, format: 'date-time' };

const filter = (field: string, operator: AnySchema, value: AnySchema): ObjectSchema => ({
  type: SchemaType.Object,
  properties: { field: literal(field), operator, value }
});

const filtersSchema: ArraySchema = {
  type: SchemaType.Array,
  definitions: {
    encoded: true
  },
  element: {
    type: SchemaType.Union,
    elements: [
      filter('search', literal('contains'), tuple({ type: SchemaType.String })),
      filter('score', literal('between'), tuple({ type: SchemaType.Number }, { type: SchemaType.Number })),
      filter('tag', options('in', 'not_in'), { type: SchemaType.Array, element: { type: SchemaType.String, format: 'uuid' } }),
      filter('provider', literal('in'), { type: SchemaType.Array, element: options('instagram', 'whatsapp') }),
      filter('date', options('before', 'after'), tuple(dateTime)),
      filter('date', literal('between'), tuple(dateTime, dateTime))
    ]
  }
};

const encode = (filters: unknown[]) => base64Encode(JSON.stringify(filters));

const assertFilterError = async (filter: unknown, errorType: new (...args: never[]) => Error) => {
  const errors = await validate(encode([filter]), filtersSchema);

  ok(errors.length > 0, 'expected validation errors');
  ok(
    errors.some((error) => error instanceof errorType),
    `expected ${errorType.name}, got ${errors.map((error) => error.constructor.name)}`
  );
};

describe('union filters inside encoded array validation', () => {
  it('assert :: every branch is valid', async () => {
    const filters = [
      { field: 'search', operator: 'contains', value: ['foo'] },
      { field: 'score', operator: 'between', value: [1, 5] },
      { field: 'tag', operator: 'not_in', value: ['4b2b0a84-7b46-4a8a-9ae5-5d7a2a6c1c11'] },
      { field: 'provider', operator: 'in', value: ['instagram', 'whatsapp'] },
      { field: 'date', operator: 'after', value: ['2026-01-01T00:00:00Z'] },
      { field: 'date', operator: 'between', value: ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'] }
    ];

    equal((await validate(encode(filters), filtersSchema)).length, 0);
  });

  it('assert :: wrong discriminant', async () => {
    // The discriminator is matched first: one error listing every accepted `field`.
    const errors = await validate(encode([{ field: 'unknown', operator: 'contains', value: ['foo'] }]), filtersSchema);

    equal(errors.length, 1);
    ok(errors[0] instanceof UnexpectedEnumValueError, errors[0].constructor.name);
  });

  it('assert :: operator from another branch', async () => {
    await assertFilterError({ field: 'search', operator: 'between', value: ['foo'] }, UnexpectedStringError);
    await assertFilterError({ field: 'tag', operator: 'contains', value: [] }, UnexpectedEnumValueError);
  });

  it('assert :: wrong tuple element type', async () => {
    await assertFilterError({ field: 'search', operator: 'contains', value: [123] }, ExpectedStringTypeError);
  });

  it('assert :: number sent as string', async () => {
    await assertFilterError({ field: 'score', operator: 'between', value: ['1', '5'] }, ExpectedNumberTypeError);
  });

  it('assert :: missing required key', async () => {
    await assertFilterError({ field: 'search', operator: 'contains' }, ExpectedTupleTypeError);
  });

  it('assert :: date only for date-time', async () => {
    await assertFilterError({ field: 'date', operator: 'after', value: ['2026-01-01'] }, ExpectedDateTimeFormatError);
  });

  it('assert :: date range with a single value', async () => {
    await assertFilterError({ field: 'date', operator: 'between', value: ['2026-01-01T00:00:00Z'] }, ExpectedStringTypeError);
  });

  it('assert :: invalid uuid inside array value', async () => {
    await assertFilterError({ field: 'tag', operator: 'in', value: ['not-a-uuid'] }, ExpectedUUIDTypeError);
  });

  it('assert :: unknown key without transformation', async () => {
    await assertFilterError({ field: 'search', operator: 'contains', value: ['foo'], extra: true }, UnexpectedPropertiesError);
  });
});
