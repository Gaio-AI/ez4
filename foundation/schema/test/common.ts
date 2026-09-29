import type { SchemaContextOptions } from '@ez4/schema';

import { readFileSync, writeFileSync } from 'node:fs';
import { deepEqual, ok } from 'node:assert/strict';

import { createSchemaContext } from '@ez4/schema';
import { buildReflection } from '@ez4/project/library';
import { getAnySchema } from '@ez4/schema/library';

export type TestFileOptions = SchemaContextOptions & {
  overwrite?: boolean;
  fileName?: string;
  nullish?: boolean;
};

export const getTestSchema = (fileName: string, options?: SchemaContextOptions) => {
  const reflection = buildReflection([`./test/input/${fileName}.ts`]);

  const entryKey = Object.keys(reflection).find((key) => key.endsWith('TestSchema'));

  ok(entryKey);

  return getAnySchema(reflection[entryKey], reflection, createSchemaContext(options));
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
