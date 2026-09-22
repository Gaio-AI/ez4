import { equal } from 'assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { isSameSourceFile } from '@ez4/common/library';

describe('common same source file', () => {
  const root = mkdtempSync(join(tmpdir(), 'ez4-same-source-'));

  const realFile = join(root, 'service.ts');
  const otherFile = join(root, 'other.ts');
  const linkedDir = join(root, 'linked');

  writeFileSync(realFile, '');
  writeFileSync(otherFile, '');
  symlinkSync(root, linkedDir, 'dir');

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('assert :: same path', () => {
    equal(isSameSourceFile(realFile, realFile), true);
  });

  it('assert :: same file through a symlink', () => {
    equal(isSameSourceFile(realFile, join(linkedDir, 'service.ts')), true);
  });

  it('assert :: different files', () => {
    equal(isSameSourceFile(realFile, otherFile), false);
  });

  it('assert :: missing file', () => {
    equal(isSameSourceFile(realFile, join(root, 'missing.ts')), false);
  });

  it('assert :: missing path', () => {
    equal(isSameSourceFile(undefined, realFile), false);
  });
});
