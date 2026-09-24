import { describe, it, before, after } from 'node:test';
import { equal, notEqual } from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFile = promisify(execFileCallback);

import { createBundleHash, getBundleHash } from '@ez4/aws-common';

/**
 * The hash decides whether a deploy bundles a function at all, so what it reacts to is the contract:
 * it follows the content and the file's place in the project, and nothing else. A checkout at
 * another absolute path and a timestamp a rebuild bumped are not changes; content that moved under
 * a preserved timestamp is.
 *
 * Each case builds two checkouts holding the same relative layout and hashes each from its own
 * root, which is what a second machine looks like. Separate absolute paths also keep the module's
 * per-file cache from answering for the case under test.
 */
describe('bundle hash', () => {
  let root: string;

  const OLD_STAMP = new Date('2020-01-01T00:00:00Z');

  const write = async (checkout: string, content: string, modified?: Date) => {
    const target = join(root, checkout, 'src/file.js');

    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);

    if (modified) {
      await utimes(target, modified, modified);
    }

    return target;
  };

  const hashInFreshProcess = async (checkout: string, file: string) => {
    // By built path, not by package name: the child runs from the temporary checkout, where the
    // repository's `node_modules` is out of reach.
    const bundled = new URL('../dist/main.mjs', import.meta.url).href;

    const source = `
      import { createBundleHash } from ${JSON.stringify(bundled)};
      process.stdout.write(await createBundleHash([${JSON.stringify(file)}]));
    `;

    const { stdout } = await execFile(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: join(root, checkout)
    });

    return stdout;
  };

  const hashFrom = async (checkout: string, file: string) => {
    const cwd = process.cwd();

    try {
      process.chdir(join(root, checkout));
      return await createBundleHash([file]);
    } finally {
      process.chdir(cwd);
    }
  };

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'ez4-bundle-hash-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not depend on where the checkout sits', async () => {
    const one = await write('place-a', 'export const a = 1;');
    const other = await write('place-b', 'export const a = 1;');

    equal(await hashFrom('place-b', other), await hashFrom('place-a', one));
  });

  it('follows the content, not the timestamp', async () => {
    const one = await write('stamp-old', 'export const a = 1;', OLD_STAMP);
    const other = await write('stamp-new', 'export const a = 1;', new Date());

    equal(await hashFrom('stamp-new', other), await hashFrom('stamp-old', one));
  });

  // Across runs, not within one: the module caches a file's signature for the life of the process,
  // and a deploy never sees a file change under it. What a deploy does see is a file that changed
  // since the run that recorded the hash — `cp -p`, a checkout that restores timestamps, a cache
  // restore. Each hash therefore runs in its own process, which is what two deploys are.
  it('catches content that changed under an unchanged timestamp', async () => {
    const target = await write('frozen', 'export const a = 1;', OLD_STAMP);
    const before = await hashInFreshProcess('frozen', target);

    await writeFile(target, 'export const a = 2;');
    await utimes(target, OLD_STAMP, OLD_STAMP);

    notEqual(await hashInFreshProcess('frozen', target), before);
  });

  it('separates files that differ only by their place', async () => {
    const one = join(root, 'named', 'src/file.js');
    const other = join(root, 'named', 'src/other.js');

    await mkdir(join(root, 'named', 'src'), { recursive: true });
    await writeFile(one, 'export const a = 1;');
    await writeFile(other, 'export const a = 1;');

    notEqual(await hashFrom('named', other), await hashFrom('named', one));
  });

  it('keeps functions built from the same source apart', async () => {
    const source = join(root, 'shared', 'src/file.js');
    const template = join(root, 'shared', 'src/template.js');

    await mkdir(join(root, 'shared', 'src'), { recursive: true });
    await writeFile(source, 'export const a = 1;');
    await writeFile(template, 'export const t = 1;');

    const cwd = process.cwd();

    try {
      process.chdir(join(root, 'shared'));
      notEqual(await getBundleHash(source, [source, template]), await getBundleHash(source, [source]));
    } finally {
      process.chdir(cwd);
    }
  });

  it('ignores the order the files arrive in', async () => {
    const one = join(root, 'ordered', 'src/file.js');
    const other = join(root, 'ordered', 'src/other.js');

    await mkdir(join(root, 'ordered', 'src'), { recursive: true });
    await writeFile(one, 'export const a = 1;');
    await writeFile(other, 'export const b = 2;');

    const cwd = process.cwd();

    try {
      process.chdir(join(root, 'ordered'));
      equal(await createBundleHash([other, one]), await createBundleHash([one, other]));
    } finally {
      process.chdir(cwd);
    }
  });
});
