import type { ObjectSchema } from '@ez4/schema';

import { deepEqual, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NamingStyle, SchemaType } from '@ez4/schema';
import { base64Encode } from '@ez4/utils';
import { resolveQueryStrings } from '@ez4/gateway/utils';
import { HttpBadRequestError } from '@ez4/gateway';

describe('http query utils', () => {
  it('assert :: get query strings', async () => {
    const querySchema: ObjectSchema = {
      type: SchemaType.Object,
      properties: {
        fooKey: {
          type: SchemaType.String
        },
        bar_Key: {
          type: SchemaType.Boolean
        },
        BazKey: {
          type: SchemaType.Number
        }
      }
    };

    const queryInput = {
      'foo-key': 'foo',
      'bar-key': 'true',
      'baz-key': '123',

      // Ignored properties
      qux: 'ignored'
    };

    const queryOutput = await resolveQueryStrings(queryInput, querySchema, {
      namingStyle: NamingStyle.KebabCase
    });

    deepEqual(queryOutput, {
      fooKey: 'foo',
      bar_Key: true,
      BazKey: 123
    });
  });

  it('assert :: get query strings (wrong parameter format)', async () => {
    const querySchema: ObjectSchema = {
      type: SchemaType.Object,
      properties: {
        fooKey: {
          type: SchemaType.String
        },
        barKey: {
          type: SchemaType.Boolean
        },
        bazKey: {
          type: SchemaType.Number
        }
      }
    };

    const queryInput = {
      fooKey: 'foo',
      barKey: 'true',
      bazKey: 'abc'
    };

    await rejects(() => resolveQueryStrings(queryInput, querySchema), HttpBadRequestError);
  });

  it('assert :: get query strings (base64 union filters)', async () => {
    const dateTime = { type: SchemaType.String, format: 'date-time' } as const;

    const querySchema: ObjectSchema = {
      type: SchemaType.Object,
      properties: {
        filters: {
          type: SchemaType.Array,
          optional: true,
          definitions: {
            encoded: true
          },
          element: {
            type: SchemaType.Union,
            elements: [
              {
                type: SchemaType.Object,
                properties: {
                  field: { type: SchemaType.String, definitions: { value: 'search' } },
                  operator: { type: SchemaType.String, definitions: { value: 'contains' } },
                  value: { type: SchemaType.Tuple, elements: [{ type: SchemaType.String }] }
                }
              },
              {
                type: SchemaType.Object,
                properties: {
                  field: { type: SchemaType.String, definitions: { value: 'date' } },
                  operator: { type: SchemaType.Enum, options: [{ value: 'before' }, { value: 'after' }] },
                  value: { type: SchemaType.Tuple, elements: [dateTime] }
                }
              },
              {
                type: SchemaType.Object,
                properties: {
                  field: { type: SchemaType.String, definitions: { value: 'date' } },
                  operator: { type: SchemaType.String, definitions: { value: 'between' } },
                  value: { type: SchemaType.Tuple, elements: [dateTime, dateTime] }
                }
              }
            ]
          }
        }
      }
    };

    const encode = (filters: unknown[]) => ({ filters: base64Encode(JSON.stringify(filters)) });

    const queryOutput = await resolveQueryStrings(
      encode([
        { field: 'search', operator: 'contains', value: ['foo', 'dropped'], extra: 'stripped' },
        { field: 'date', operator: 'between', value: ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'] }
      ]),
      querySchema
    );

    deepEqual(queryOutput, {
      filters: [
        { field: 'search', operator: 'contains', value: ['foo'] },
        { field: 'date', operator: 'between', value: ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'] }
      ]
    });

    await rejects(
      () => resolveQueryStrings(encode([{ field: 'date', operator: 'during', value: ['2026-01-01T00:00:00Z'] }]), querySchema),
      HttpBadRequestError
    );
    await rejects(
      () => resolveQueryStrings(encode([{ field: 'date', operator: 'after', value: ['2026-01-01'] }]), querySchema),
      HttpBadRequestError
    );
  });
  it('assert :: get query strings (base64 union with invalid optional properties)', async () => {
    const enumOf = (...values: string[]) =>
      ({ type: SchemaType.Enum, optional: true, options: values.map((value) => ({ value })) }) as const;

    const querySchema: ObjectSchema = {
      type: SchemaType.Object,
      properties: {
        custom_fields: {
          type: SchemaType.Array,
          optional: true,
          definitions: {
            encoded: true
          },
          element: {
            type: SchemaType.Union,
            elements: [
              {
                type: SchemaType.Object,
                properties: {
                  id: { type: SchemaType.String },
                  value: { type: SchemaType.String },
                  type: enumOf('text', 'number', 'dropdown'),
                  operator: {
                    type: SchemaType.Union,
                    optional: true,
                    elements: [
                      { type: SchemaType.String, definitions: { value: 'equals' } },
                      { type: SchemaType.String, definitions: { value: 'greater_than' } }
                    ]
                  }
                }
              },
              {
                type: SchemaType.Object,
                properties: {
                  workflow_id: { type: SchemaType.String, format: 'uuid' },
                  node_id: { type: SchemaType.String },
                  event_type: enumOf('sent', 'opened'),
                  read_only: { type: SchemaType.Boolean, optional: true }
                }
              }
            ]
          }
        }
      }
    };

    const workflowId = '4b2b0a84-7b46-4a8a-9ae5-5d7a2a6c1c11';
    const encode = (entries: unknown[]) => ({ custom_fields: base64Encode(JSON.stringify(entries)) });

    const invalidEntries = [
      { id: 'a', value: '1', type: 'date', operator: 'greater_than' },
      { id: 'a', value: '1', operator: 'foo' },
      { workflow_id: workflowId, node_id: 'n', event_type: 'click' },
      { workflow_id: workflowId, node_id: 'n', read_only: 'yes' }
    ];

    for (const entry of invalidEntries) {
      await rejects(() => resolveQueryStrings(encode([entry]), querySchema), HttpBadRequestError, JSON.stringify(entry));
    }

    const queryOutput = await resolveQueryStrings(
      encode([
        { id: 'a', value: '1', type: 'number', operator: 'greater_than', extra: 'stripped' },
        { id: 'b', value: '2' },
        { workflow_id: workflowId, node_id: 'n', event_type: 'opened', read_only: true }
      ]),
      querySchema
    );

    deepEqual(queryOutput, {
      custom_fields: [
        { id: 'a', value: '1', type: 'number', operator: 'greater_than' },
        { id: 'b', value: '2' },
        { workflow_id: workflowId, node_id: 'n', event_type: 'opened', read_only: true }
      ]
    });
  });
});
