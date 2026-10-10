import { describe, it, before, after } from 'node:test';
import { deepEqual, equal, notEqual } from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getFunctionBundle } from '@ez4/aws-common';

/**
 * A group bundle imports several handlers into one function, and its template picks one per call.
 */
describe('group bundle', () => {
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

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'ez4-group-bundle-'));

    // Both files export the same name.
    await writeCode(join(root, 'tags/list.ts'), `export const main = () => 'list';\n`);
    await writeCode(join(root, 'tags/create.ts'), `export const main = () => 'create';\n`);
    await writeCode(join(root, 'tags/audit.ts'), `export const audit = () => 'audit';\n`);

    await writeCode(join(root, 'template.ts'), `export const entryPoint = () => __EZ4_HANDLERS.map((handle) => handle());\n`);
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const bundleGroup = (groupName: string, handlers: { sourceFile: string; functionName: string }[]) => {
    return fromRoot(() => {
      return getFunctionBundle('test', {
        templateFile: 'template.ts',
        resourceName: `${groupName}-function`,
        filePrefix: 'test',
        groupName,
        handlers
      });
    });
  };

  it('assert :: every handler is reached by its position', async () => {
    const bundleFile = await bundleGroup('tags', [
      { sourceFile: 'tags/list.ts', functionName: 'main' },
      { sourceFile: 'tags/create.ts', functionName: 'main' },
      { sourceFile: 'tags/audit.ts', functionName: 'audit' }
    ]);

    const { entryPoint } = await import(pathToFileURL(join(root, bundleFile)).href);

    deepEqual(entryPoint(), ['list', 'create', 'audit']);
  });

  it('assert :: the bundle is cached by the group name', async () => {
    const tagsFile = await bundleGroup('tags', [{ sourceFile: 'tags/audit.ts', functionName: 'audit' }]);
    const auditFile = await bundleGroup('audit', [{ sourceFile: 'tags/audit.ts', functionName: 'audit' }]);

    // Built by the case above, under the same group name.
    equal(tagsFile, await bundleGroup('tags', []));

    notEqual(auditFile, tagsFile);

    const { entryPoint } = await import(pathToFileURL(join(root, auditFile)).href);

    deepEqual(entryPoint(), ['audit']);
  });
});
