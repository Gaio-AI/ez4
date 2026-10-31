import { describe, it } from 'node:test';
import { equal } from 'node:assert/strict';

import { SchemaType } from '@ez4/schema';
import { getColumnDefault } from '../../src/utils/columns';

describe('migration column default tests', () => {
  it('assert :: escape string default', () => {
    const value = getColumnDefault(
      {
        type: SchemaType.String,
        definitions: {
          default: `O'Reilly`
        }
      },
      false
    );

    equal(value, `'O''Reilly'`);
  });

  it('assert :: escape json default', () => {
    const value = getColumnDefault(
      {
        type: SchemaType.Object,
        properties: {},
        definitions: {
          default: {
            author: `O'Reilly`
          }
        }
      },
      false
    );

    equal(value, `'{"author":"O''Reilly"}'`);
  });

  it('assert :: timestamp column default', () => {
    const value = getColumnDefault(
      {
        type: SchemaType.String,
        format: 'date-time',
        definitions: {
          default: '2026-01-01T00:00:00.000Z'
        }
      },
      false,
      true
    );

    equal(value, `date_trunc('milliseconds', statement_timestamp())`);
  });
});
