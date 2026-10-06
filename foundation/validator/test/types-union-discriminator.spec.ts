import type { AnySchema, ObjectSchemaProperties } from '@ez4/schema';
import type { ValidationCustomContext, ValidationCustomHandler } from '@ez4/validator';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { SchemaType } from '@ez4/schema';
import { createValidatorContext, UnexpectedEnumValueError, ValidationError, validate } from '@ez4/validator';

const literal = (value: string): AnySchema => ({ type: SchemaType.String, definitions: { value } });

const object = (properties: ObjectSchemaProperties): AnySchema => ({ type: SchemaType.Object, properties });

const node = (type: string, data: ObjectSchemaProperties) => object({ type: literal(type), data: object(data) });

const elements = [
  node('message', {
    text: { type: SchemaType.String, definitions: { maxLength: 10 } }
  }),
  node('media', {
    kind: literal('image'),
    mime: literal('image/png')
  }),
  node('media', {
    kind: literal('audio'),
    mime: {
      type: SchemaType.Enum,
      options: [{ value: 'audio/aac' }, { value: 'audio/wav' }]
    }
  })
];

const nodeSchema: AnySchema = {
  type: SchemaType.Union,
  elements
};

const customNodeSchema: AnySchema = {
  type: SchemaType.Union,
  definitions: {
    custom: true,
    types: ['node']
  },
  elements
};

const getErrorPaths = async (value: unknown, schema: AnySchema, onCustomValidation?: ValidationCustomHandler) => {
  const errors = await validate(value, schema, createValidatorContext({ property: '$', onCustomValidation }));

  return errors.map((error) => (error instanceof ValidationError ? error.propertyName : undefined));
};

describe('union discriminator validation', () => {
  it('assert :: matching branch', async () => {
    deepEqual(await getErrorPaths({ type: 'message', data: { text: 'hi' } }, nodeSchema), []);
    deepEqual(await getErrorPaths({ type: 'media', data: { kind: 'audio', mime: 'audio/wav' } }, nodeSchema), []);
  });

  it('assert :: errors come only from the branch the discriminators select', async () => {
    // Both `media` branches fail with one error each; `kind` picks the `audio` one.
    deepEqual(await getErrorPaths({ type: 'media', data: { kind: 'audio', mime: 'image/png' } }, nodeSchema), ['$.data.mime']);
  });

  it('assert :: unknown discriminator value', async () => {
    const errors = await validate({ type: 'handoff', data: {} }, nodeSchema, createValidatorContext({ property: '$' }));

    equal(errors.length, 1);

    const [error] = errors;

    ok(error instanceof UnexpectedEnumValueError);
    equal(error.propertyName, '$.type');
  });

  it('assert :: unknown nested discriminator value', async () => {
    deepEqual(await getErrorPaths({ type: 'media', data: { kind: 'video', mime: 'video/mp4' } }, nodeSchema), ['$.data.kind']);
  });

  it('assert :: missing discriminator falls back to every branch', async () => {
    const paths = await getErrorPaths({ data: { text: 'hi' } }, nodeSchema);

    deepEqual(paths, ['$.type']);
  });

  it('assert :: custom validation runs once a branch matches', async () => {
    const handler = mock.fn((_value: unknown, _context: ValidationCustomContext) => {});

    deepEqual(await getErrorPaths({ type: 'message', data: { text: 'hi' } }, customNodeSchema, handler), []);

    equal(handler.mock.callCount(), 1);
    equal(handler.mock.calls[0].arguments[1].type, 'node');
  });

  it('assert :: custom validation is skipped when no branch matches', async () => {
    const handler = mock.fn((_value: unknown, _context: ValidationCustomContext) => {});

    deepEqual(await getErrorPaths({ type: 'message', data: { text: 'a long message' } }, customNodeSchema, handler), ['$.data.text']);

    equal(handler.mock.callCount(), 0);
  });

  it('assert :: custom validation reports every error of an AggregateError', async () => {
    const handler = mock.fn((_value: unknown, { property }: ValidationCustomContext) => {
      throw new AggregateError([new ValidationError('first', `${property}.data.a`), new Error('second')]);
    });

    deepEqual(await getErrorPaths({ type: 'message', data: { text: 'hi' } }, customNodeSchema, handler), ['$.data.a', '$']);
  });
});
