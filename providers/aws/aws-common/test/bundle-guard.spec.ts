import { describe, it, before, after } from 'node:test';
import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getFunctionBundle } from '@ez4/aws-common';

/**
 * A guarded handler runs behind its guard, which gets the handler's request and context and the route's `allow`.
 */
describe('guarded bundle', () => {
  let root: string;

  const writeCode = async (path: string, content: string) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  };

  const fromRoot = async <T>(callback: () => Promise<T>) => {
    const cwd = process.cwd();

    try {
      process.chdir(root);
      return await callback();
    } finally {
      process.chdir(cwd);
    }
  };

  const importBundle = (bundleFile: string) => {
    return import(pathToFileURL(join(root, bundleFile)).href);
  };

  const guard = (allow: unknown) => ({
    entrypoint: { sourceFile: 'guard.ts', functionName: 'roleGuard' },
    allow
  });

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'ez4-guard-bundle-'));

    await writeCode(join(root, 'items/list.ts'), `export const main = (request, context) => ['list', request.role, context.name];\n`);
    await writeCode(join(root, 'items/create.ts'), `export const main = (request) => ['create', request.role];\n`);

    await writeCode(
      join(root, 'guard.ts'),
      [
        `export const roleGuard = async (request, allow, context) => {`,
        `  if (!allow.includes(request.role)) throw new Error(\`refused \${request.role} by \${allow} in \${context.name}\`);`,
        `};`
      ].join('\n')
    );

    await writeCode(join(root, 'request.ts'), `export const entryPoint = (request) => handle(request, { name: 'context' });\n`);

    await writeCode(
      join(root, 'group.ts'),
      `export const entryPoint = (position, request) => __EZ4_HANDLERS[position](request, { name: 'context' });\n`
    );
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const bundleRequest = (resourceName: string, handlerGuard?: ReturnType<typeof guard>) => {
    return fromRoot(() => {
      return getFunctionBundle('test', {
        templateFile: 'request.ts',
        resourceName,
        filePrefix: 'test',
        handler: {
          sourceFile: 'items/list.ts',
          functionName: 'main',
          ...(handlerGuard && { guard: handlerGuard })
        }
      });
    });
  };

  it('assert :: the guard runs before the handler and can refuse it', async () => {
    const bundleFile = await bundleRequest('guarded-function', guard(['reader', 'writer']));

    const { entryPoint } = await importBundle(bundleFile);

    deepEqual(await entryPoint({ role: 'reader' }), ['list', 'reader', 'context']);

    await rejects(() => entryPoint({ role: 'guest' }), { message: 'refused guest by reader,writer in context' });
  });

  it('assert :: the same handler without a guard is another bundle that runs it directly', async () => {
    const guardedFile = await bundleRequest('guarded-function', guard(['reader']));
    const plainFile = await bundleRequest('plain-function');

    notEqual(plainFile, guardedFile);

    const { entryPoint } = await importBundle(plainFile);

    deepEqual(await entryPoint({ role: 'guest' }), ['list', 'guest', 'context']);

    const plainCode = await readFile(join(root, plainFile), 'utf-8');

    ok(!plainCode.includes('__EZ4_GUARD'));
  });

  it('assert :: another allow for the same handler is another bundle', async () => {
    const readerFile = await bundleRequest('reader-function', guard(['reader']));
    const writerFile = await bundleRequest('writer-function', guard(['writer']));

    notEqual(readerFile, writerFile);

    const { entryPoint } = await importBundle(writerFile);

    deepEqual(await entryPoint({ role: 'writer' }), ['list', 'writer', 'context']);

    await rejects(() => entryPoint({ role: 'reader' }), { message: 'refused reader by writer in context' });
  });

  it('assert :: each handler of a group runs behind its own allow', async () => {
    const bundleFile = await fromRoot(() => {
      return getFunctionBundle('test', {
        templateFile: 'group.ts',
        resourceName: 'items-function',
        filePrefix: 'test',
        groupName: 'items',
        handlers: [
          { sourceFile: 'items/list.ts', functionName: 'main', guard: guard(['reader', 'writer']) },
          { sourceFile: 'items/create.ts', functionName: 'main', guard: guard(['writer']) },
          { sourceFile: 'items/create.ts', functionName: 'main' }
        ]
      });
    });

    const { entryPoint } = await importBundle(bundleFile);

    deepEqual(await entryPoint(0, { role: 'reader' }), ['list', 'reader', 'context']);
    deepEqual(await entryPoint(1, { role: 'writer' }), ['create', 'writer']);
    deepEqual(await entryPoint(2, { role: 'guest' }), ['create', 'guest']);

    await rejects(() => entryPoint(1, { role: 'reader' }), { message: 'refused reader by writer in context' });

    const code = await readFile(join(root, bundleFile), 'utf-8');

    // One import of the guard serves every handler behind it.
    equal(code.match(/var roleGuard=/g)?.length, 1);
  });
});
