import { describe, it, after } from 'node:test';
import { deepEqual, throws } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { getReflectionSources, ReflectionSourceFileNotFound } from '@ez4/project/library';

describe('project reflection sources', () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'ez4-reflection-sources-'));

  const createFile = (path: string) => {
    const filePath = join(projectPath, path);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, '');

    return filePath;
  };

  const apiFile = createFile('src/api.ts');
  const firstQueueFile = createFile('src/queues/first.ts');
  const secondQueueFile = createFile('src/queues/second.ts');
  const dependencyFile = createFile('src/node_modules/dependency/index.ts');
  const routeFile = createFile('routes/[id].ts');

  after(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('reflection sources :: file path', () => {
    deepEqual(getReflectionSources([apiFile]), [apiFile]);
  });

  it('reflection sources :: relative file path', () => {
    deepEqual(getReflectionSources(['./src/library.ts']), [resolve('src/library.ts')]);
  });

  it('reflection sources :: glob pattern', () => {
    deepEqual(getReflectionSources([join(projectPath, 'src/queues/*.ts')]), [firstQueueFile, secondQueueFile]);
  });

  it('reflection sources :: directories not matched', () => {
    deepEqual(getReflectionSources([join(projectPath, 'src/*')]), [apiFile]);
  });

  it('reflection sources :: node_modules excluded', () => {
    deepEqual(getReflectionSources([join(projectPath, 'src/**/*.ts')]), [apiFile, firstQueueFile, secondQueueFile]);
  });

  it('reflection sources :: file path inside node_modules', () => {
    deepEqual(getReflectionSources([dependencyFile]), [dependencyFile]);
  });

  it('reflection sources :: file name with glob characters', () => {
    deepEqual(getReflectionSources([routeFile]), [routeFile]);
  });

  it('reflection sources :: file reached twice', () => {
    deepEqual(getReflectionSources([apiFile, join(projectPath, 'src/**/*.ts')]), [apiFile, firstQueueFile, secondQueueFile]);
  });

  it('reflection sources :: missing file', () => {
    throws(() => getReflectionSources([join(projectPath, 'src/missing.ts')]), ReflectionSourceFileNotFound);
  });

  it('reflection sources :: pattern without matches', () => {
    throws(() => getReflectionSources([join(projectPath, 'src/missing/*.ts')]), ReflectionSourceFileNotFound);
  });
});
