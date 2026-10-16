import { describe, it } from 'node:test';
import { deepEqual, notEqual, ok, rejects } from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultGit } from '../src/workspace/git';
import {
  checkoutWorkspace,
  publishWorkspace,
  pushWorkspaceBranch,
  refreshCache,
  withLock,
  type WorkspaceRuntime
} from '../src/workspace/runtime';

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

describe('workspace :: unsafe names', () => {
  it('rejects invalid repo, agent, and invocation names before filesystem or git use', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-unsafe-'));
    let gitCalls = 0;
    const runtime: WorkspaceRuntime = {
      root,
      workspace: { repos: [{ name: '../outside', url: 'https://github.com/acme/api.git', branch: 'main' }] },
      git: async () => {
        gitCalls++;
        throw new Error('git must not run');
      }
    };
    await rejects(refreshCache(runtime, runtime.workspace.repos[0]), /Invalid workspace repository name/);
    await rejects(checkoutWorkspace(runtime, join(root, 'work')), /Invalid workspace repository name/);
    await rejects(
      publishWorkspace(runtime, { dir: root, repos: { '../outside': { path: root, base: 'base' } } }, 'Agent', 'id'),
      /Invalid workspace repository name/
    );
    await rejects(
      publishWorkspace(runtime, { dir: root, repos: { api: { path: root, base: 'base' } } }, '../Agent', 'id'),
      /Invalid workspace agent name/
    );
    await rejects(
      publishWorkspace(runtime, { dir: root, repos: { api: { path: root, base: 'base' } } }, 'Agent', '../id'),
      /Invalid workspace invocation id/
    );
    deepEqual(gitCalls, 0);
  });
});

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

  it('assert :: push lands the published head on the branch and the next round fast-forwards it', async () => {
    const { runtime, workdir, remote } = await setupWorkspace({ repos: ['api'] });
    const remoteHead = async () => (await git(['rev-parse', 'refs/heads/agent/fix'], { cwd: join(remote, 'api.git') })).stdout.trim();

    const first = await checkoutWorkspace(runtime, workdir);
    await writeFile(join(first.repos.api.path, 'fix.txt'), 'fixed');
    const firstRefs = await publishWorkspace(runtime, first, 'Implement', 'inv-1');
    await pushWorkspaceBranch(runtime, first, firstRefs, 'api', 'agent/fix');
    deepEqual(await remoteHead(), firstRefs[0].head);

    const second = await checkoutWorkspace(runtime, await mkdtemp(join(tmpdir(), 'wd-')), firstRefs);
    await writeFile(join(second.repos.api.path, 'fix.txt'), 'fixed again');
    const secondRefs = await publishWorkspace(runtime, second, 'Implement', 'inv-2');
    await pushWorkspaceBranch(runtime, second, secondRefs, 'api', 'agent/fix');
    deepEqual(await remoteHead(), secondRefs[0].head);
  });

  it('assert :: push rejects a diverged branch, the workspace branch and an invalid name', async () => {
    const { runtime, workdir, remote } = await setupWorkspace({ repos: ['api'] });
    const first = await checkoutWorkspace(runtime, workdir);
    await writeFile(join(first.repos.api.path, 'one.txt'), 'one');
    await pushWorkspaceBranch(runtime, first, await publishWorkspace(runtime, first, 'Implement', 'inv-1'), 'api', 'agent/fix');

    const other = await checkoutWorkspace(runtime, await mkdtemp(join(tmpdir(), 'wd-')));
    await writeFile(join(other.repos.api.path, 'two.txt'), 'two');
    const otherRefs = await publishWorkspace(runtime, other, 'Implement', 'inv-2');
    await rejects(pushWorkspaceBranch(runtime, other, otherRefs, 'api', 'agent/fix'), /rejected|fetch first|non-fast-forward/);
    await rejects(pushWorkspaceBranch(runtime, other, otherRefs, 'api', 'main'), /Refusing to push the workspace branch/);
    await rejects(pushWorkspaceBranch(runtime, other, otherRefs, 'api', 'bad..name'), /Invalid branch name/);
    await rejects(pushWorkspaceBranch(runtime, other, [], 'api', 'agent/other'), /has no published commit/);

    const { stdout } = await git(['rev-parse', 'refs/heads/main'], { cwd: join(remote, 'api.git') });
    notEqual(stdout.trim(), otherRefs[0].head);
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

  it('assert :: drops the lock directory when recording the owner fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-lock-fail-'));
    const lockPath = join(root, 'test.git.lock');
    const writeError = new Error('simulated disk error');

    await rejects(
      () =>
        withLock(
          lockPath,
          () => Date.now(),
          async () => {},
          async () => {
            throw writeError;
          }
        ),
      writeError
    );

    ok(!existsSync(lockPath));
    await rm(root, { recursive: true, force: true });
  });

  it('does not let the old owner remove a replacement lock after takeover', async () => {
    const { runtime } = await setupWorkspace({ repos: ['api'] });
    const lock = join(runtime.root, 'repos/api.git.lock');
    const originalGit = runtime.git ?? git;
    const { promise: entered, resolve: enteredFetch } = Promise.withResolvers<void>();
    const { promise: held, resolve: releaseFetch } = Promise.withResolvers<void>();
    runtime.git = async (args, opts) => {
      if (args[0] === 'fetch') {
        enteredFetch();
        await held;
      }
      return originalGit(args, opts);
    };
    const first = refreshCache(runtime, runtime.workspace.repos[0]);
    await entered;
    const ownerFile = join(lock, 'owner');
    const oldOwner = await readFile(ownerFile, 'utf8');
    await utimes(ownerFile, new Date(Date.now() - 11 * 60_000), new Date(Date.now() - 11 * 60_000));
    const second = refreshCache(runtime, runtime.workspace.repos[0]);
    let replacement!: string;
    for (let attempt = 0; attempt < 30; attempt++) {
      replacement = await readFile(ownerFile, 'utf8').catch(() => '');
      if (replacement && replacement !== oldOwner) break;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 100);
      await promise;
    }
    notEqual(replacement, oldOwner);
    releaseFetch();
    await first;
    deepEqual(await readFile(ownerFile, 'utf8'), replacement);
    await second;
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
