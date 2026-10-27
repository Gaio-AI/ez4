import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURES = resolve('test/files/module-version');
const EXTENSIONS = resolve('bin/extensions.mjs');

type DriverOutput = {
  results: unknown[];
  loads: Record<string, number>;
};

/**
 * Copy of the fixtures where `@fixture/*` are workspace packages: symlinks in `node_modules` to directories
 * outside it, as npm links a workspace.
 */
const prepareFixtures = () => {
  const directory = mkdtempSync(join(tmpdir(), 'ez4-module-version-'));

  cpSync(FIXTURES, directory, { recursive: true });

  mkdirSync(join(directory, 'node_modules/@fixture'), { recursive: true });

  symlinkSync(join(directory, 'packages/source'), join(directory, 'node_modules/@fixture/source'));
  symlinkSync(join(directory, 'packages/built'), join(directory, 'node_modules/@fixture/built'));

  return directory;
};

const runDriver = (entry: string, versions: string[]): DriverOutput => {
  const directory = prepareFixtures();

  try {
    const { EZ4_PROJECT_FILE, ...env } = process.env;

    const result = spawnSync(
      process.execPath,
      [
        '--no-warnings',
        '--experimental-strip-types',
        '--experimental-transform-types',
        '--import',
        EXTENSIONS,
        'driver.mjs',
        entry,
        ...versions
      ],
      {
        cwd: directory,
        env,
        encoding: 'utf-8'
      }
    );

    equal(result.status, 0, result.stderr);

    return JSON.parse(result.stdout.trim().split('\n').pop()!);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe('module version', () => {
  it('assert :: one instance of each module within a version', () => {
    const { results, loads } = runDriver('diamond/entry.ts', ['1']);

    deepEqual(results, [true]);

    deepEqual(loads, {
      ['diamond/entry.ts']: 1,
      ['diamond/thrower.ts']: 1,
      ['diamond/errors.ts']: 1
    });
  });

  it('assert :: import cycle within a version', () => {
    const { results, loads } = runDriver('cycle/entry.ts', ['1']);

    deepEqual(results, ['entry <-> other']);

    deepEqual(loads, {
      ['cycle/entry.ts']: 1,
      ['cycle/other.ts']: 1
    });
  });

  it('assert :: a new version loads every module once more', () => {
    const { results, loads } = runDriver('diamond/entry.ts', ['1', '2']);

    deepEqual(results, [true, true]);

    deepEqual(loads, {
      ['diamond/entry.ts']: 2,
      ['diamond/thrower.ts']: 2,
      ['diamond/errors.ts']: 2
    });
  });

  it('assert :: a new version reloads workspace source, not built packages', () => {
    const { results, loads } = runDriver('workspace/entry.ts', ['1', '2']);

    deepEqual(results, ['source built', 'source built']);

    deepEqual(loads, {
      ['workspace/entry.ts']: 2,
      ['packages/source/src/index.ts']: 2,
      ['packages/built/lib/index.mjs']: 1
    });
  });

  // A spec imports with no version (`-`), and the handlers a tester runs load on version 0.
  it('assert :: tests keep project modules apart from what a spec imports', () => {
    const { results, loads } = runDriver('diamond/entry.ts', ['-', '0']);

    deepEqual(results, [true, true]);

    deepEqual(loads, {
      ['diamond/entry.ts']: 2,
      ['diamond/thrower.ts']: 2,
      ['diamond/errors.ts']: 2
    });
  });

  it('assert :: tests share workspace source with what a spec imports', () => {
    const { results, loads } = runDriver('workspace/entry.ts', ['-', '0']);

    deepEqual(results, ['source built', 'source built']);

    deepEqual(loads, {
      ['workspace/entry.ts']: 2,
      ['packages/source/src/index.ts']: 1,
      ['packages/built/lib/index.mjs']: 1
    });
  });
});
