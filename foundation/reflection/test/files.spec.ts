import type { ReflectionOptions } from '@ez4/reflection';

import { deepEqual, ok } from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { getReflectionFiles, getReflectionProgramFromFiles } from '@ez4/reflection';

const redirectOptions: ReflectionOptions = {
  compilerEvents: {
    onResolveFileName: (fileName) => fileName.replace(/\/redirected\.ts$/, '/replacement.ts')
  }
};

const isProjectFile = (fileName: string) => !fileName.includes('/node_modules/');

describe('reflection files', () => {
  it('assert :: dependencies from the reflection program', () => {
    const { getReflectionFiles } = getReflectionProgramFromFiles(['./test/files/entry.ts']);

    const dependencies = getReflectionFiles(['test/files/service.ts', 'test/files/handler.ts']);

    deepEqual(dependencies['test/files/service.ts'], ['test/files/service.ts', 'test/files/shared.ts']);

    deepEqual(dependencies['test/files/handler.ts'].filter(isProjectFile), [
      'test/files/handler.ts',
      'test/files/shared.ts',
      'test/files/redirected.ts',
      'test/files/only-on-disk.ts',
      'test/files/deep.ts'
    ]);

    ok(dependencies['test/files/handler.ts'].includes('../../node_modules/@ez4/utils/dist/main.d.ts'));
  });

  it('assert :: a redirected file keeps the imports of the file on disk', () => {
    const fileNames = ['test/files/service.ts', 'test/files/handler.ts'];

    const { getReflectionFiles: getProgramFiles } = getReflectionProgramFromFiles(['./test/files/entry.ts'], redirectOptions);

    deepEqual(getProgramFiles(fileNames), getReflectionFiles(fileNames));
  });

  it('assert :: a file given by a relative name reaches the same packages', () => {
    const relativeName = 'test/files/handler.ts';
    const absoluteName = resolve(relativeName);

    const [, ...relativeDependencies] = getReflectionFiles([relativeName])[relativeName];
    const [, ...absoluteDependencies] = getReflectionFiles([absoluteName])[absoluteName];

    deepEqual(relativeDependencies, absoluteDependencies);
  });

  it('assert :: same dependencies as a program of their own', () => {
    const fileNames = readdirSync('./test/types').map((fileName) => `test/types/${fileName}`);

    const { getReflectionFiles: getProgramFiles } = getReflectionProgramFromFiles(fileNames);

    deepEqual(getProgramFiles(fileNames), getReflectionFiles(fileNames));
  });
});
