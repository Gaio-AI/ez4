import type { SchemaContext, SchemaContextOptions } from '@ez4/schema';

import { readFileSync, writeFileSync } from 'node:fs';
import { deepEqual, ok } from 'node:assert/strict';

import { createSchemaContext } from '@ez4/schema';
import { buildReflection } from '@ez4/project/library';
import { createDocumentationSchemaContext, getAnySchema } from '@ez4/schema/library';

export type TestFileOptions = SchemaContextOptions & {
  overwrite?: boolean;
  fileName?: string;
  nullish?: boolean;
};

const getTestSchemaWithContext = (fileName: string, context: SchemaContext) => {
  const reflection = buildReflection([`./test/input/${fileName}.ts`]);

  const entryKey = Object.keys(reflection).find((key) => key.endsWith('TestSchema'));

  ok(entryKey);

  return getAnySchema(reflection[entryKey], reflection, context);
};

export const getTestSchema = (fileName: string, options?: SchemaContextOptions) => {
  return getTestSchemaWithContext(fileName, createSchemaContext(options));
};

/**
 * The schema as an HTTP contract builds it, documented by the JSDoc of its types.
 */
export const getDocumentationTestSchema = (fileName: string) => {
  return getTestSchemaWithContext(fileName, createDocumentationSchemaContext());
};

export const testFile = (fileName: string, options?: TestFileOptions) => {
  const outputFile = `./test/output/${options?.fileName ?? fileName}.json`;

  const schema = getTestSchema(fileName, options);

  if (options?.overwrite) {
    writeFileSync(outputFile, JSON.stringify(schema, undefined, 2));
  } else {
    deepEqual(schema, JSON.parse(readFileSync(outputFile).toString()));
  }
};
