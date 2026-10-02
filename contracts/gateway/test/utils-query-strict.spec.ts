import type { ObjectSchema } from '@ez4/schema';

import { deepEqual, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NamingStyle, SchemaType } from '@ez4/schema';
import { assertQueryStrings, resolveQueryStrings } from '@ez4/gateway/utils';
import { HttpBadRequestError } from '@ez4/gateway';

describe('http strict query utils', () => {
  const querySchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      tagId: {
        type: SchemaType.String,
        optional: true
      },
      tags: {
        type: SchemaType.Array,
        optional: true,
        element: {
          type: SchemaType.String
        }
      }
    }
  };

  const strictPreferences = {
    namingStyle: NamingStyle.SnakeCase,
    strictQueryStrings: true
  };

  const getMessage = (names: string[]) => {
    if (names.length === 1) {
      return `Property [${names[0]}] is not expected.`;
    }

    return `Properties [${names.join(', ')}] are not expected.`;
  };

  const assertRejected = async (input: Record<string, string>, schema: ObjectSchema | undefined, names: string[]) => {
    await rejects(
      () => assertQueryStrings(input, schema, strictPreferences),
      (error) => {
        deepEqual(error instanceof HttpBadRequestError && [error.message, error.context], [
          'Malformed query strings.',
          {
            details: [
              {
                code: 'UnexpectedPropertiesError',
                message: getMessage(names),
                path: '$query',
                properties: names,
                input
              }
            ]
          }
        ]);

        return true;
      }
    );
  };

  it('assert :: strict query strings reject an undeclared name', async () => {
    await assertRejected({ tag: 'a' }, querySchema, ['$query.tag']);
    await assertRejected({ tag_id: 'a', tag: 'b', other: 'c' }, querySchema, ['$query.tag', '$query.other']);
  });

  it('assert :: strict query strings compare names in the input naming style', async () => {
    await assertQueryStrings({ tag_id: 'a' }, querySchema, strictPreferences);

    await assertRejected({ tagId: 'a' }, querySchema, ['$query.tagId']);
  });

  it('assert :: strict query strings accept array values', async () => {
    const input = { tags: 'a,b' };

    await assertQueryStrings(input, querySchema, strictPreferences);

    deepEqual(await resolveQueryStrings(input, querySchema, strictPreferences), {
      tags: ['a', 'b']
    });
  });

  it('assert :: strict query strings accept any name of an extensible schema', async () => {
    const extensibleSchema: ObjectSchema = {
      ...querySchema,
      definitions: {
        extensible: true
      }
    };

    await assertQueryStrings({ tag_id: 'a', other: 'b' }, extensibleSchema, strictPreferences);
  });

  it('assert :: strict query strings accept the names of an additional schema', async () => {
    const additionalSchema: ObjectSchema = {
      ...querySchema,
      additional: {
        property: {
          type: SchemaType.String
        },
        value: {
          type: SchemaType.String
        }
      }
    };

    await assertQueryStrings({ tag_id: 'a', other: 'b' }, additionalSchema, strictPreferences);
  });

  it('assert :: strict query strings reject any name without a schema', async () => {
    await assertQueryStrings({}, undefined, strictPreferences);

    await assertRejected({ tag: 'a' }, undefined, ['$query.tag']);
  });

  it('assert :: query strings without the strict preference accept any name', async () => {
    await assertQueryStrings({ tag: 'a' }, querySchema, { namingStyle: NamingStyle.SnakeCase });
    await assertQueryStrings({ tag: 'a' }, undefined, undefined);
  });
});
