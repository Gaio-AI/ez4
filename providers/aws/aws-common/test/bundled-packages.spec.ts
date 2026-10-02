import { describe, it, before, after } from 'node:test';
import { deepEqual, equal, notEqual } from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectBundledPackages, getBundledPackages, getFunctionBundle, getInstalledPackages, getPackagesHash } from '@ez4/aws-common';

/**
 * A bundle carries the code of the packages it imports from `node_modules`, which the source hash
 * doesn't follow. What a function bundled is recorded as each package's root and the version
 * installed there, both read from the files esbuild reports as bundle inputs, so a later deploy can
 * tell whether any of them changed.
 *
 * Every case lays out its own folder: versions are read once per process, as a deploy reads them,
 * so a folder another case already read would answer with what it held then.
 */
describe('bundled packages', () => {
  let root: string;

  const writeJson = async (path: string, content: object) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(content));
  };

  const writeCode = async (path: string, content = 'export const value = 1;') => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  };

  const install = async (project: string, packagePath: string, version: string, files = ['index.js']) => {
    const name = packagePath.split('node_modules/').at(-1);

    await writeJson(join(root, project, packagePath, 'package.json'), { name, version });

    for (const file of files) {
      await writeCode(join(root, project, packagePath, file));
    }
  };

  const fromProject = async <T>(project: string, callback: () => Promise<T>) => {
    const cwd = process.cwd();

    try {
      process.chdir(join(root, project));
      return await callback();
    } finally {
      process.chdir(cwd);
    }
  };

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'ez4-bundled-packages-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds the package each bundled file belongs to', async () => {
    await install('layouts', 'node_modules/plain', '1.0.0', ['lib/index.js']);
    await install('layouts', 'node_modules/@scope/pkg', '2.0.0', ['dist/a.js', 'dist/b.js']);
    await install('layouts', 'node_modules/plain/node_modules/nested', '3.0.0');
    await install('layouts', 'node_modules/.pnpm/@scope+other@4.0.0/node_modules/@scope/other', '4.0.0');

    const packages = await fromProject('layouts', () => {
      return collectBundledPackages([
        'node_modules/plain/lib/index.js',
        'node_modules/@scope/pkg/dist/a.js',
        'node_modules/@scope/pkg/dist/b.js',
        'node_modules/plain/node_modules/nested/index.js',
        'node_modules/.pnpm/@scope+other@4.0.0/node_modules/@scope/other/index.js'
      ]);
    });

    deepEqual(packages, [
      { path: 'node_modules/.pnpm/@scope+other@4.0.0/node_modules/@scope/other', version: '4.0.0' },
      { path: 'node_modules/@scope/pkg', version: '2.0.0' },
      { path: 'node_modules/plain', version: '1.0.0' },
      { path: 'node_modules/plain/node_modules/nested', version: '3.0.0' }
    ]);
  });

  it('keeps the path relative to the project, above it included', async () => {
    await install('hoisted', 'node_modules/shared', '1.2.3');
    await writeCode(join(root, 'hoisted/packages/api/src/handler.ts'));

    const packages = await fromProject('hoisted/packages/api', () => {
      return collectBundledPackages(['src/handler.ts', '../../node_modules/shared/index.js']);
    });

    deepEqual(packages, [{ path: '../../node_modules/shared', version: '1.2.3' }]);
  });

  it('takes the version from the package root, not from a folder inside it', async () => {
    await install('subpath', 'node_modules/plain', '1.0.0', ['sub/index.js']);
    await writeJson(join(root, 'subpath/node_modules/plain/sub/package.json'), { type: 'module' });

    const packages = await fromProject('subpath', () => {
      return collectBundledPackages(['node_modules/plain/sub/index.js']);
    });

    deepEqual(packages, [{ path: 'node_modules/plain', version: '1.0.0' }]);
  });

  it('leaves out what is not an installed package', async () => {
    await writeCode(join(root, 'others/src/handler.ts'));
    await writeCode(join(root, 'common/src/index.ts'));
    await writeCode(join(root, 'others/node_modules/loose.js'));
    await writeCode(join(root, 'others/node_modules/unnamed/index.js'));

    const packages = await fromProject('others', () => {
      return collectBundledPackages([
        '<stdin>',
        'src/handler.ts',
        '../common/src/index.ts',
        'node_modules/loose.js',
        'node_modules/unnamed/index.js'
      ]);
    });

    deepEqual(packages, []);
  });

  it('hashes the same while the installed versions stay', async () => {
    await install('unchanged', 'node_modules/plain', '1.0.0');
    await install('unchanged', 'node_modules/@scope/pkg', '2.0.0');

    await fromProject('unchanged', async () => {
      const packages = await collectBundledPackages(['node_modules/plain/index.js', 'node_modules/@scope/pkg/index.js']);

      equal(getPackagesHash(await getInstalledPackages(packages)), getPackagesHash(packages));
    });
  });

  it('hashes differently once an installed version changed', async () => {
    await install('bumped', 'node_modules/plain', '1.0.1');
    await install('bumped', 'node_modules/@scope/pkg', '2.0.0');

    // What a deploy recorded before the lockfile moved `plain` from 1.0.0 to 1.0.1.
    const recorded = [
      { path: 'node_modules/@scope/pkg', version: '2.0.0' },
      { path: 'node_modules/plain', version: '1.0.0' }
    ];

    await fromProject('bumped', async () => {
      const installed = await getInstalledPackages(recorded);

      deepEqual(installed, [
        { path: 'node_modules/@scope/pkg', version: '2.0.0' },
        { path: 'node_modules/plain', version: '1.0.1' }
      ]);

      notEqual(getPackagesHash(installed), getPackagesHash(recorded));
    });
  });

  it('hashes differently once an installed package is gone', async () => {
    await install('removed', 'node_modules/@scope/pkg', '2.0.0');

    const recorded = [
      { path: 'node_modules/@scope/pkg', version: '2.0.0' },
      { path: 'node_modules/plain', version: '1.0.0' }
    ];

    await fromProject('removed', async () => {
      const installed = await getInstalledPackages(recorded);

      deepEqual(installed, [{ path: 'node_modules/@scope/pkg', version: '2.0.0' }]);

      notEqual(getPackagesHash(installed), getPackagesHash(recorded));
    });
  });

  // esbuild reports inputs by their real path, so a workspace package linked into `node_modules`
  // shows up as its own source, which the source hash already follows.
  it('records the installed packages of a bundle the bundler built', async () => {
    await install('bundled', 'node_modules/fixture-lib', '1.0.0');
    await writeCode(join(root, 'bundled/node_modules/fixture-lib/index.js'), `export const greet = () => 'installed';`);

    await writeJson(join(root, 'bundled/packages/linked/package.json'), {
      name: '@workspace/linked',
      version: '0.0.0',
      main: 'src/index.ts'
    });
    await writeCode(join(root, 'bundled/packages/linked/src/index.ts'), `export const shout = () => 'linked';`);

    await mkdir(join(root, 'bundled/node_modules/@workspace'), { recursive: true });
    await symlink('../../packages/linked', join(root, 'bundled/node_modules/@workspace/linked'));

    await writeCode(
      join(root, 'bundled/handler.ts'),
      `import { greet } from 'fixture-lib';\nimport { shout } from '@workspace/linked';\n\nexport const main = () => greet() + shout();\n`
    );

    await writeCode(join(root, 'bundled/template.ts'), `export const entryPoint = () => handle();\n`);

    const packages = await fromProject('bundled', async () => {
      const bundleFile = await getFunctionBundle('test', {
        templateFile: 'template.ts',
        resourceName: 'bundled-function',
        filePrefix: 'test',
        handler: {
          sourceFile: 'handler.ts',
          functionName: 'main'
        }
      });

      return getBundledPackages(bundleFile);
    });

    deepEqual(packages, [{ path: 'node_modules/fixture-lib', version: '1.0.0' }]);
  });
});
