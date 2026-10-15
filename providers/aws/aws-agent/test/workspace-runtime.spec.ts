import { describe, it } from 'node:test';
import { deepEqual, notEqual, ok, rejects } from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultGit } from '../src/workspace/git';
import { checkoutWorkspace, publishWorkspace, refreshCache, type WorkspaceRuntime } from '../src/workspace/runtime';

const git = defaultGit;

interface SetupOptions {
  repos: string[];
  token?: string;
  remoteUrl?: string;
  oldRef?: { name: string; leaseAgeDays: number };
  freshRef?: { name: string; leaseAgeDays: number };
}

const setupWorkspace = async (options: SetupOptions) => {
  const remoteDir = await mkdtemp(join(tmpdir(), 'remotes-'));
  const rootDir = await mkdtemp(join(tmpdir(), 'ws-root-'));
  const workdir = await mkdtemp(join(tmpdir(), 'wd-'));

  for (const repo of options.repos) {
    const remotePath = join(remoteDir, `${repo}.git`);
    await mkdir(remotePath, { recursive: true });
    await git(['init', '--bare', remotePath], { cwd: remoteDir });

    const seedDir = await mkdtemp(join(tmpdir(), 'seed-'));
    await git(['init', '-b', 'main', seedDir], { cwd: seedDir });
    await writeFile(join(seedDir, 'README.md'), `# ${repo}\n`);
    await git(['add', '.'], { cwd: seedDir });
    await git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], { cwd: seedDir });
    await git(['push', remotePath, 'main'], { cwd: seedDir });
    await rm(seedDir, { recursive: true, force: true });
  }

  const runtime: WorkspaceRuntime = {
    root: rootDir,
    workspace: {
      repos: options.repos.map((name) => ({
        name,
        url: options.remoteUrl ?? `file://${join(remoteDir, `${name}.git`)}`,
        branch: 'main'
      }))
    },
    token: options.token ? async () => options.token : undefined
  };

  if (options.oldRef || options.freshRef) {
    for (const repo of runtime.workspace.repos) {
      await refreshCache(runtime, repo);
      const cacheDir = join(rootDir, 'repos', `${repo.name}.git`);
      const branch = repo.branch || 'main';
      const { stdout: headSha } = await git(['rev-parse', `refs/heads/${branch}`], { cwd: cacheDir });

      if (options.oldRef) {
        await git(['update-ref', options.oldRef.name, headSha.trim()], { cwd: cacheDir });
        const match = options.oldRef.name.match(/^refs\/ez4\/([^/]+)\/(.+)$/);
        if (match) {
          const leasePath = join(rootDir, 'leases', repo.name, match[1], match[2]);
          await mkdir(dirname(leasePath), { recursive: true });
          await writeFile(leasePath, '');
          const mtime = new Date(Date.now() - options.oldRef.leaseAgeDays * 86_400_000);
          await utimes(leasePath, mtime, mtime);
        }
      }

      if (options.freshRef) {
        await git(['update-ref', options.freshRef.name, headSha.trim()], { cwd: cacheDir });
        const match = options.freshRef.name.match(/^refs\/ez4\/([^/]+)\/(.+)$/);
        if (match) {
          const leasePath = join(rootDir, 'leases', repo.name, match[1], match[2]);
          await mkdir(dirname(leasePath), { recursive: true });
          await writeFile(leasePath, '');
          const mtime = new Date(Date.now() - options.freshRef.leaseAgeDays * 86_400_000);
          await utimes(leasePath, mtime, mtime);
        }
      }
    }
  }

  return {
    runtime,
    workdir,
    remote: remoteDir
  };
};

const commitToRemote = async (remoteDir: string, repo: string, filename: string) => {
  const remotePath = join(remoteDir, `${repo}.git`);
  const workDir = await mkdtemp(join(tmpdir(), 'commit-'));
  await git(['clone', remotePath, workDir], { cwd: tmpdir() });
  await writeFile(join(workDir, filename), 'upstream content');
  await git(['add', '.'], { cwd: workDir });
  await git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', `add ${filename}`], { cwd: workDir });
  await git(['push', 'origin', 'main'], { cwd: workDir });
  await rm(workDir, { recursive: true, force: true });
};

describe('workspace :: runtime', () => {
  it('assert :: published refs survive a cache refresh', async () => {
    const { runtime, workdir, remote } = await setupWorkspace({ repos: ['api'] });
    const request = await checkoutWorkspace(runtime, workdir);
    await writeFile(join(request.repos.api.path, 'fix.txt'), 'fixed');
    const [ref] = await publishWorkspace(runtime, request, 'Implement', 'inv-1');
    deepEqual(ref.ref, 'refs/ez4/Implement/inv-1');
    deepEqual(ref.changed, true);
    await commitToRemote(remote, 'api', 'upstream.txt');
    await refreshCache(runtime, runtime.workspace.repos[0]);
    const { stdout } = await git(['rev-parse', 'refs/ez4/Implement/inv-1'], {
      cwd: join(runtime.root, 'repos/api.git')
    });
    deepEqual(stdout.trim(), ref.head);
  });

  it('assert :: next agent starts at the published head with the original base', async () => {
    const { runtime, workdir } = await setupWorkspace({ repos: ['api'] });
    const first = await checkoutWorkspace(runtime, workdir);
    await writeFile(join(first.repos.api.path, 'fix.txt'), 'fixed');
    const refs = await publishWorkspace(runtime, first, 'Implement', 'inv-1');
    const second = await checkoutWorkspace(runtime, await mkdtemp(join(tmpdir(), 'wd-')), refs);
    deepEqual(second.repos.api.base, refs[0].base);
    deepEqual(await readFile(join(second.repos.api.path, 'fix.txt'), 'utf8'), 'fixed');
  });

  it('assert :: unchanged repo is reported as not changed', async () => {
    const { runtime, workdir } = await setupWorkspace({ repos: ['api'] });
    const request = await checkoutWorkspace(runtime, workdir);
    const [ref] = await publishWorkspace(runtime, request, 'Implement', 'inv-2');
    deepEqual(ref.changed, false);
  });

  it('assert :: token stays out of git config and errors', async () => {
    const { runtime, workdir } = await setupWorkspace({
      repos: ['api'],
      token: 'ghs_secret',
      remoteUrl: 'file:///does/not/exist'
    });
    await rejects(
      () => checkoutWorkspace(runtime, workdir),
      (error: Error) =>
        !error.message.includes('ghs_secret') && !error.message.includes(Buffer.from('x-access-token:ghs_secret').toString('base64'))
    );
    ok(!(await readFile(join(runtime.root, 'repos'), 'utf8').catch(() => '')).includes('ghs_secret'));
  });

  it('assert :: stale lock is taken over', async () => {
    const { runtime } = await setupWorkspace({ repos: ['api'] });
    const lock = join(runtime.root, 'repos/api.git.lock');
    await mkdir(lock, { recursive: true });
    await utimes(lock, new Date(Date.now() - 11 * 60_000), new Date(Date.now() - 11 * 60_000));
    await refreshCache(runtime, runtime.workspace.repos[0]);
    ok(!existsSync(lock));
  });

  it('assert :: refs whose lease is older than 14 days are pruned, leased refs survive', async () => {
    const { runtime } = await setupWorkspace({
      repos: ['api'],
      oldRef: { name: 'refs/ez4/Implement/old', leaseAgeDays: 15 },
      freshRef: { name: 'refs/ez4/Implement/live', leaseAgeDays: 1 }
    });
    await refreshCache(runtime, runtime.workspace.repos[0]);
    const { exitCode } = await git(['rev-parse', '--verify', 'refs/ez4/Implement/old'], {
      cwd: join(runtime.root, 'repos/api.git')
    });
    notEqual(exitCode, 0);
    const live = await git(['rev-parse', '--verify', 'refs/ez4/Implement/live'], {
      cwd: join(runtime.root, 'repos/api.git')
    });
    deepEqual(live.exitCode, 0);
  });
});
