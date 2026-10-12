import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { getTestFiles } from '../src/terminal/commands/test';

const files = [
  'test/client.spec.ts',
  'test/deploy-table.lab.spec.ts',
  'test/query/insert.spec.ts',
  'test/common/schema.ts',
  'src/main.ts',
  'node_modules/fixture/test/fixture.spec.ts'
];

describe('test files', () => {
  it('assert :: without patterns every spec file runs', () => {
    deepEqual(getTestFiles(files), ['test/client.spec.ts', 'test/deploy-table.lab.spec.ts', 'test/query/insert.spec.ts']);
  });

  it('assert :: a pattern keeps the spec files whose path contains it', () => {
    deepEqual(getTestFiles(files, ['query/', 'client']), ['test/client.spec.ts', 'test/query/insert.spec.ts']);
  });

  it('assert :: a pattern starting with ! drops the spec files whose path contains the rest', () => {
    deepEqual(getTestFiles(files, ['!.lab.spec']), ['test/client.spec.ts', 'test/query/insert.spec.ts']);
  });

  it('assert :: an exclusion applies after the patterns that keep files', () => {
    deepEqual(getTestFiles(files, ['test/', '!.lab.spec', '!query/']), ['test/client.spec.ts']);
  });
});
