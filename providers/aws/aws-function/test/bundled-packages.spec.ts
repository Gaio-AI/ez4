import { describe, it, before, after } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFile = promisify(execFileCallback);

type DeployReport = {
  action?: string;
  changes?: {
    create?: Record<string, unknown>;
    update?: Record<string, unknown>;
  };
  result?: {
    bundledPackages?: { path: string; version: string }[];
    packagesHash?: string;
  };
  errors: string[];
  commands: string[];
};

/**
 * A function bundles the code of every package it imports, while its source hash follows the files
 * TypeScript reaches, which for a package are its declarations. A package that changed underneath a
 * function still has to reach it: a library patched by a lockfile bump, a runtime fixed by a release
 * of the framework itself.
 *
 * The project lives in a temporary folder with a package installed in its own `node_modules`, which
 * the cases change between deploys. Each deploy runs in a process of its own (see `common/deploy.ts`)
 * with Lambda answered in place, so an upload is a recorded `UpdateFunctionCodeCommand`.
 */
describe('function bundled packages', { timeout: 120000 }, () => {
  const deployScript = fileURLToPath(new URL('./common/deploy.ts', import.meta.url));

  let projectPath: string;
  let stateFile: string;
  let created: DeployReport;

  const installPackage = async (version: string, greeting: string) => {
    const packagePath = join(projectPath, 'node_modules/fixture-lib');

    await mkdir(packagePath, { recursive: true });

    await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: 'fixture-lib', version, type: 'module', main: 'index.js' }));
    await writeFile(join(packagePath, 'index.d.ts'), 'export declare const greet: () => string;');
    await writeFile(join(packagePath, 'index.js'), `export const greet = () => '${greeting}';`);
  };

  const deployProject = async (): Promise<DeployReport> => {
    const reportFile = join(projectPath, 'report.json');

    await execFile(process.execPath, ['--experimental-strip-types', '--no-warnings', deployScript, stateFile, reportFile], {
      cwd: projectPath,
      env: {
        ...process.env,
        // Lambda never leaves the process, and anything else that tried would find nothing here.
        AWS_ENDPOINT_URL: 'http://127.0.0.1:9',
        AWS_ACCESS_KEY_ID: 'local',
        AWS_SECRET_ACCESS_KEY: 'local',
        AWS_REGION: 'us-east-1'
      }
    });

    const report: DeployReport = JSON.parse(await readFile(reportFile, 'utf8'));

    deepEqual(report.errors, []);

    return report;
  };

  const readBundle = () => {
    return readFile(join(projectPath, '.ez4/fixture.handler.main.mjs'), 'utf8');
  };

  const forgetPackages = async () => {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));

    for (const entryId in state) {
      if (state[entryId].type === 'aws:lambda.function') {
        delete state[entryId].result.bundledPackages;
        delete state[entryId].result.packagesHash;
      }
    }

    await writeFile(stateFile, JSON.stringify(state));
  };

  before(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'ez4-bundled-packages-'));
    stateFile = join(projectPath, 'state.json');

    await writeFile(join(projectPath, 'handler.ts'), `import { greet } from 'fixture-lib';\n\nexport const main = () => greet();\n`);
    await writeFile(join(projectPath, 'template.ts'), `export const entryPoint = () => handle();\n`);

    await installPackage('1.0.0', 'first');

    created = await deployProject();
  });

  after(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('records the packages a new function bundles', () => {
    equal(created.action, 'create');

    deepEqual(created.result?.bundledPackages, [{ path: 'node_modules/fixture-lib', version: '1.0.0' }]);
  });

  it('leaves a function alone when nothing it bundles changed', async () => {
    const report = await deployProject();

    equal(report.changes, undefined);
    deepEqual(report.commands, []);
  });

  // A state written before the list existed has nothing to compare: the function is rebundled once,
  // and the code is uploaded only if the new bundle differs from the deployed one.
  it('rebundles a function deployed before its packages were recorded, without uploading the same code', async () => {
    await forgetPackages();

    const report = await deployProject();

    const outcome = {
      planned: 'packagesHash' in (report.changes?.create ?? {}),
      commands: report.commands
    };

    deepEqual(outcome, { planned: true, commands: [] });
    deepEqual(report.result?.bundledPackages, [{ path: 'node_modules/fixture-lib', version: '1.0.0' }]);
  });

  it('uploads a function when a package it bundles changes version', async () => {
    await installPackage('1.0.1', 'second');

    const report = await deployProject();

    const outcome = {
      planned: 'packagesHash' in (report.changes?.update ?? {}),
      uploaded: report.commands.includes('UpdateFunctionCodeCommand')
    };

    deepEqual(outcome, { planned: true, uploaded: true });
    deepEqual(report.result?.bundledPackages, [{ path: 'node_modules/fixture-lib', version: '1.0.1' }]);

    ok((await readBundle()).includes('second'));
  });

  // The version is the signal: code changed in place under the same version (a hand edit, a patch
  // applied after install) is not seen, as it was not before.
  it('does not see a package whose code changed under the same version', async () => {
    await installPackage('1.0.1', 'third');

    const report = await deployProject();

    equal(report.changes, undefined);
    deepEqual(report.commands, []);
  });
});
