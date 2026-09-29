import type { AnySchema, ArraySchema, ObjectSchema } from '@ez4/schema';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';
import { createTransformContext, transform } from '@ez4/transform';
import { base64Encode } from '@ez4/utils';

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

describe('union filters inside encoded array transformation', () => {
  it('assert :: every branch decodes unchanged', () => {
    const filters = [
      { field: 'search', operator: 'contains', value: ['foo'] },
      { field: 'score', operator: 'between', value: [1, 5] },
      { field: 'tag', operator: 'not_in', value: ['4b2b0a84-7b46-4a8a-9ae5-5d7a2a6c1c11'] },
      { field: 'provider', operator: 'in', value: ['instagram', 'whatsapp'] },
      { field: 'date', operator: 'after', value: ['2026-01-01T00:00:00Z'] },
      { field: 'date', operator: 'between', value: ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'] }
    ];

    deepEqual(transform(encode(filters), filtersSchema), filters);
  });

  it('assert :: same discriminant resolves by operator', () => {
    const between = { field: 'date', operator: 'between', value: ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'] };
    const before = { field: 'date', operator: 'before', value: ['2026-01-01T00:00:00Z'] };

    deepEqual(transform(encode([between, before]), filtersSchema), [between, before]);
  });

  it('assert :: unknown keys are stripped', () => {
    const filters = [{ field: 'search', operator: 'contains', value: ['foo'], extra: true }];

    deepEqual(transform(encode(filters), filtersSchema), [{ field: 'search', operator: 'contains', value: ['foo'] }]);
  });

  it('assert :: tuple elements beyond the declared length are dropped', () => {
    const filters = [{ field: 'search', operator: 'contains', value: ['foo', 'bar'] }];

    deepEqual(transform(encode(filters), filtersSchema), [{ field: 'search', operator: 'contains', value: ['foo'] }]);
  });

  it('assert :: filters matching no branch are kept for validation', () => {
    const filters = [
      { field: 'unknown', operator: 'contains', value: ['foo'] },
      { field: 'search', operator: 'between', value: ['foo'] }
    ];

    deepEqual(transform(encode(filters), filtersSchema), filters);
  });
});

const optionalLiterals = (...values: string[]): AnySchema => ({
  type: SchemaType.Union,
  optional: true,
  elements: values.map(literal)
});

const customField: ObjectSchema = {
  type: SchemaType.Object,
  properties: {
    id: { type: SchemaType.String },
    value: { type: SchemaType.String },
    type: { ...options('text', 'number', 'dropdown'), optional: true },
    operator: optionalLiterals('equals', 'greater_than')
  }
};

const workflowNode: ObjectSchema = {
  type: SchemaType.Object,
  properties: {
    workflow_id: { type: SchemaType.String, format: 'uuid' },
    node_id: { type: SchemaType.String },
    event_type: { ...options('sent', 'opened'), optional: true },
    read_only: { type: SchemaType.Boolean, optional: true },
    count: { type: SchemaType.Number, optional: true }
  }
};

const encodedUnionSchema: ArraySchema = {
  type: SchemaType.Array,
  definitions: { encoded: true },
  element: { type: SchemaType.Union, elements: [customField, workflowNode] }
};

const workflowId = '4b2b0a84-7b46-4a8a-9ae5-5d7a2a6c1c11';

describe('declared optional properties with invalid values', () => {
  const invalidEntries = [
    { id: 'a', value: '1', type: 'date' },
    { id: 'a', value: '1', operator: 'foo' },
    { workflow_id: workflowId, node_id: 'n', event_type: 'click' },
    { workflow_id: workflowId, node_id: 'n', read_only: 'yes' },
    { workflow_id: workflowId, node_id: 'n', count: '5' }
  ];

  for (const entry of invalidEntries) {
    it(`assert :: union branch keeps invalid value ${JSON.stringify(entry)}`, () => {
      deepEqual(transform(encode([entry]), encodedUnionSchema), [entry]);
    });

    it(`assert :: plain object keeps invalid value ${JSON.stringify(entry)}`, () => {
      const schema = 'id' in entry ? customField : workflowNode;

      deepEqual(transform(entry, schema, createTransformContext({ convert: false })), entry);
    });

    it(`assert :: tuple object keeps invalid value ${JSON.stringify(entry)}`, () => {
      const schema: AnySchema = { type: SchemaType.Tuple, elements: ['id' in entry ? customField : workflowNode] };

      deepEqual(transform([entry], schema, createTransformContext({ convert: false })), [entry]);
    });
  }

  it('assert :: valid and absent optional properties still match', () => {
    const entries = [
      { id: 'a', value: '1', type: 'number', operator: 'greater_than' },
      { id: 'a', value: '1' },
      { workflow_id: workflowId, node_id: 'n', event_type: 'opened', read_only: false, count: 3 }
    ];

    deepEqual(transform(encode(entries), encodedUnionSchema), entries);
  });

  it('assert :: null on a non-nullable optional is dropped and the branch still matches', () => {
    const schema: AnySchema = { type: SchemaType.Union, elements: [customField, workflowNode] };

    deepEqual(transform({ workflow_id: workflowId, node_id: 'n', count: null }, schema, createTransformContext({ convert: false })), {
      workflow_id: workflowId,
      node_id: 'n'
    });
  });

  it('assert :: unknown keys and extra tuple elements are still dropped', () => {
    const schema: AnySchema = { type: SchemaType.Tuple, elements: [workflowNode] };

    deepEqual(transform(encode([{ id: 'a', value: '1', extra: true }]), encodedUnionSchema), [{ id: 'a', value: '1' }]);
    deepEqual(transform([{ workflow_id: workflowId, node_id: 'n', extra: 1 }, 'dropped'], schema), [
      { workflow_id: workflowId, node_id: 'n' }
    ]);
  });

  it('assert :: optional number inside union still converts when convert is on', () => {
    const schema: AnySchema = { type: SchemaType.Union, elements: [customField, workflowNode] };

    deepEqual(transform({ workflow_id: workflowId, node_id: 'n', count: '5' }, schema), {
      workflow_id: workflowId,
      node_id: 'n',
      count: 5
    });
  });
});
