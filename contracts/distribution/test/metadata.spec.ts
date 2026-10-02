import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerTriggers, getCdnServicesMetadata } from '@ez4/distribution/library';
import { buildReflection } from '@ez4/project/library';

const testFile = (fileName: string, overwrite = false) => {
  const sourceFile = `./test/input/output-${fileName}.ts`;
  const outputFile = `./test/output/${fileName}.json`;

  const reflection = buildReflection([sourceFile]);
  const result = getCdnServicesMetadata(reflection);

  result.errors.forEach((error) => {
    console.error(error.message);
  });

  equal(result.errors.length, 0);

  if (!existsSync(outputFile) || overwrite) {
    writeFileSync(outputFile, JSON.stringify(result.services, undefined, 2));
  } else {
    deepEqual(result.services, JSON.parse(readFileSync(outputFile).toString()));
  }
};

describe('distribution metadata', () => {
  registerTriggers();

  process.env.TEST_ENV_VAR = 'test-env-var-value';
  process.env.TEST_FIREWALL_ARN = 'arn:aws:wafv2:us-east-1:000000000000:global/webacl/test-env/f0e1d2c3-0000-1111-2222-333344445555';

  it('assert :: basic distribution', () => testFile('service'));
  it('assert :: rewrite rules', () => testFile('rewrite'));
  it('assert :: firewall', () => testFile('firewall'));
});
