import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Agent } from '@ez4/agent';
import type { AgentService } from '@ez4/agent/library';
import { defaultGit, type Git } from './git';

export const WORKSPACE_MOUNT_PATH = '/mnt/ez4-workspace';

export type WorkspaceRepoMeta = Required<Agent.WorkspaceRepo>;

export type WorkspaceRuntime = {
  root: string;
  workspace: NonNullable<AgentService['workspace']>;
  token?: () => Promise<string | undefined>;
  git?: Git;
  now?: () => number;
};

const redact = (text: string, token?: string): string => {
  if (!token) return text;
  const basicAuth = Buffer.from(`x-access-token:${token}`).toString('base64');
  return text.replaceAll(token, '[REDACTED]').replaceAll(basicAuth, '[REDACTED]');
};

export const authEnv = (url: string, token: string): Record<string, string> => {
  let origin = url;
  try {
    const parsed = new URL(url);
    if (parsed.origin && parsed.origin !== 'null') {
      origin = parsed.origin;
    }
  } catch {
    origin = url;
  }
  const basicAuth = Buffer.from(`x-access-token:${token}`).toString('base64');
  const headerValue = `AUTHORIZATION: basic ${basicAuth}`;
  const headerKey = `http.${origin}/.extraheader`;

  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: headerKey,
    GIT_CONFIG_VALUE_0: headerValue,
    KEY_0: headerKey,
    VALUE_0: headerValue
  };
};

const getNowMs = (runtime: WorkspaceRuntime): number => {
  if (runtime.now) {
    const val = runtime.now();
    return val < 10_000_000_000 ? val * 1000 : val;
  }
  return Date.now();
};

export const withLock = async <T>(lockPath: string, nowFn: () => number, fn: () => Promise<T>, writeOwner = writeFile): Promise<T> => {
  const timeoutMs = 5 * 60_000;
  const staleMs = 10 * 60_000;
  const start = Date.now();
  const ownerPath = join(lockPath, 'owner');
  const owner = randomUUID();

  while (true) {
    try {
      await mkdir(lockPath);
    } catch (err: unknown) {
      if (!err || typeof err !== 'object' || !('code' in err) || err.code !== 'EEXIST') throw err;
      try {
        const stats = await stat(ownerPath).catch(async (error: unknown) => {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return stat(lockPath);
          throw error;
        });
        if (nowFn() - stats.mtimeMs > staleMs) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
      }

      if (Date.now() - start >= timeoutMs) throw new Error(`Lock timeout on ${lockPath}`);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 2000);
      await promise;
      continue;
    }

    try {
      await writeOwner(ownerPath, owner);
      break;
    } catch (err) {
      await rm(lockPath, { recursive: true, force: true });
      throw err;
    }
  }

  let heartbeat: Promise<void> = Promise.resolve();
  const interval = setInterval(() => {
    heartbeat = heartbeat.then(async () => {
      if ((await readFile(ownerPath, 'utf8').catch(() => '')) !== owner) return;
      const date = new Date(nowFn());
      await utimes(ownerPath, date, date).catch(() => {});
    });
  }, 30_000);
  interval.unref();

  try {
    return await fn();
  } finally {
    clearInterval(interval);
    await heartbeat;
    if ((await readFile(ownerPath, 'utf8').catch(() => '')) === owner) {
      await rm(lockPath, { recursive: true, force: true });
    }
  }
};

const assertWorkspaceName = (kind: 'repository' | 'agent' | 'invocation id', name: string): void => {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error(`Invalid workspace ${kind} name '${name}'`);
  }
};

const touchLease = async (root: string, repo: string, agent: string, id: string, nowMs: number): Promise<void> => {
  assertWorkspaceName('repository', repo);
  assertWorkspaceName('agent', agent);
  assertWorkspaceName('invocation id', id);
  const leaseFile = join(root, 'leases', repo, agent, id);
  await mkdir(dirname(leaseFile), { recursive: true });
  const date = new Date(nowMs);
  try {
    await utimes(leaseFile, date, date);
  } catch {
    await writeFile(leaseFile, '');
    await utimes(leaseFile, date, date);
  }
};

export const refreshCache = async (runtime: WorkspaceRuntime, repo: WorkspaceRepoMeta): Promise<string> => {
  assertWorkspaceName('repository', repo.name);
  const git = runtime.git ?? defaultGit;
  const reposDir = join(runtime.root, 'repos');
  const cachePath = join(reposDir, `${repo.name}.git`);
  const lockPath = `${cachePath}.lock`;
  const token = runtime.token ? await runtime.token() : undefined;
  const nowMs = getNowMs(runtime);

  await mkdir(reposDir, { recursive: true });

  return withLock(
    lockPath,
    () => getNowMs(runtime),
    async () => {
      let exists = false;
      try {
        await stat(cachePath);
        exists = true;
      } catch {
        exists = false;
      }

      if (!exists) {
        const tmpPath = join(reposDir, `.tmp-${randomUUID()}`);
        await mkdir(tmpPath, { recursive: true });
        const initResult = await git(['init', '--bare'], { cwd: tmpPath });
        if (initResult.exitCode !== 0) {
          await rm(tmpPath, { recursive: true, force: true }).catch(() => {});
          throw new Error(redact(initResult.stderr || initResult.stdout, token));
        }
        await rename(tmpPath, cachePath);
      }

      const env = token ? authEnv(repo.url, token) : undefined;
      const branch = repo.branch || 'main';
      const fetchResult = await git(['fetch', '--prune', repo.url, '+refs/heads/*:refs/heads/*'], { cwd: cachePath, env });

      if (fetchResult.exitCode !== 0) {
        throw new Error(redact(fetchResult.stderr || fetchResult.stdout || 'git fetch failed', token));
      }

      await git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: cachePath });

      const refsResult = await git(['for-each-ref', '--format=%(refname)', 'refs/ez4/'], { cwd: cachePath });

      if (refsResult.exitCode === 0 && refsResult.stdout.trim().length > 0) {
        const refLines = refsResult.stdout.trim().split('\n');
        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

        for (const rawRef of refLines) {
          const refName = rawRef.trim();
          const match = refName.match(/^refs\/ez4\/([^/]+)\/(.+)$/);
          if (!match) continue;
          const agent = match[1];
          const id = match[2];
          if (
            !/^[A-Za-z0-9._-]+$/.test(agent) ||
            agent === '.' ||
            agent === '..' ||
            !/^[A-Za-z0-9._-]+$/.test(id) ||
            id === '.' ||
            id === '..'
          )
            continue;
          const leaseFile = join(runtime.root, 'leases', repo.name, agent, id);

          let prune = false;
          try {
            const leaseStat = await stat(leaseFile);
            if (nowMs - leaseStat.mtimeMs > fourteenDaysMs) {
              prune = true;
            }
          } catch {
            prune = true;
          }

          if (prune) {
            await git(['update-ref', '-d', refName], { cwd: cachePath });
            await rm(leaseFile, { force: true }).catch(() => {});
          }
        }
      }

      return cachePath;
    }
  );
};

export const checkoutWorkspace = async (
  runtime: WorkspaceRuntime,
  workdir: string,
  refs?: Agent.WorkspaceRef[]
): Promise<Agent.WorkspaceRequest> => {
  for (const repo of runtime.workspace.repos) assertWorkspaceName('repository', repo.name);
  for (const ref of refs ?? []) {
    assertWorkspaceName('repository', ref.repo);
    const match = ref.ref.match(/^refs\/ez4\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`Invalid workspace ref '${ref.ref}'`);
    assertWorkspaceName('agent', match[1]);
    assertWorkspaceName('invocation id', match[2]);
  }
  const git = runtime.git ?? defaultGit;
  const token = runtime.token ? await runtime.token() : undefined;
  const nowMs = getNowMs(runtime);
  const resultRepos: Record<string, { path: string; base: string }> = {};

  await mkdir(workdir, { recursive: true });

  for (const repo of runtime.workspace.repos) {
    const cachePath = await refreshCache(runtime, repo);
    const targetDir = join(workdir, repo.name);
    const ref = refs?.find((r) => r.repo === repo.name);

    if (ref) {
      const match = ref.ref.match(/^refs\/ez4\/([^/]+)\/(.+)$/);
      if (match) {
        await touchLease(runtime.root, repo.name, match[1], match[2], nowMs);
      }
    }

    const branch = repo.branch || 'main';
    const cloneResult = await git(['clone', '--shared', '--branch', branch, cachePath, targetDir], { cwd: workdir });

    if (cloneResult.exitCode !== 0) {
      throw new Error(redact(cloneResult.stderr || cloneResult.stdout || 'git clone failed', token));
    }

    const setUrlResult = await git(['remote', 'set-url', 'origin', repo.url], { cwd: targetDir });

    if (setUrlResult.exitCode !== 0) {
      throw new Error(redact(setUrlResult.stderr || setUrlResult.stdout || 'git remote set-url failed', token));
    }

    let base: string;
    if (ref) {
      const fetchRefResult = await git(['fetch', cachePath, ref.ref], { cwd: targetDir });
      if (fetchRefResult.exitCode !== 0) {
        throw new Error(redact(fetchRefResult.stderr || fetchRefResult.stdout || 'git fetch ref failed', token));
      }

      const checkoutResult = await git(['checkout', '--detach', ref.head], { cwd: targetDir });
      if (checkoutResult.exitCode !== 0) {
        throw new Error(redact(checkoutResult.stderr || checkoutResult.stdout || 'git checkout failed', token));
      }

      base = ref.base;
    } else {
      const revParseResult = await git(['rev-parse', 'HEAD'], { cwd: targetDir });
      if (revParseResult.exitCode !== 0) {
        throw new Error(redact(revParseResult.stderr || revParseResult.stdout || 'git rev-parse HEAD failed', token));
      }
      base = revParseResult.stdout.trim();
    }

    resultRepos[repo.name] = {
      path: targetDir,
      base
    };
  }

  return {
    dir: workdir,
    repos: resultRepos
  };
};

export const publishWorkspace = async (
  runtime: WorkspaceRuntime,
  request: Agent.WorkspaceRequest,
  agent: string,
  id: string
): Promise<Agent.WorkspaceRef[]> => {
  assertWorkspaceName('agent', agent);
  assertWorkspaceName('invocation id', id);
  for (const repoName of Object.keys(request.repos)) assertWorkspaceName('repository', repoName);
  const git = runtime.git ?? defaultGit;
  const token = runtime.token ? await runtime.token() : undefined;
  const nowMs = getNowMs(runtime);
  const publishedRefs: Agent.WorkspaceRef[] = [];

  for (const [repoName, { path: repoDir, base }] of Object.entries(request.repos)) {
    const cachePath = join(runtime.root, 'repos', `${repoName}.git`);

    const addResult = await git(['add', '-A'], { cwd: repoDir });
    if (addResult.exitCode !== 0) {
      throw new Error(redact(addResult.stderr || addResult.stdout || 'git add failed', token));
    }

    const diffResult = await git(['diff', '--cached', '--quiet'], { cwd: repoDir });
    if (diffResult.exitCode !== 0) {
      const commitResult = await git(
        ['-c', 'user.name=ez4-agent', '-c', 'user.email=agent@ez4.invalid', 'commit', '-m', `${agent} ${id}`],
        { cwd: repoDir }
      );
      if (commitResult.exitCode !== 0) {
        throw new Error(redact(commitResult.stderr || commitResult.stdout || 'git commit failed', token));
      }
    }

    const headResult = await git(['rev-parse', 'HEAD'], { cwd: repoDir });
    if (headResult.exitCode !== 0) {
      throw new Error(redact(headResult.stderr || headResult.stdout || 'git rev-parse HEAD failed', token));
    }
    const head = headResult.stdout.trim();
    const changed = head !== base;
    const refName = `refs/ez4/${agent}/${id}`;

    const pushResult = await git(['push', cachePath, `HEAD:${refName}`], { cwd: repoDir });
    if (pushResult.exitCode !== 0) {
      throw new Error(redact(pushResult.stderr || pushResult.stdout || 'git push failed', token));
    }

    await touchLease(runtime.root, repoName, agent, id, nowMs);

    publishedRefs.push({
      repo: repoName,
      base,
      head,
      ref: refName,
      changed
    });
  }

  return publishedRefs;
};

/**
 * Pushes the commit published for `repoName` to `branch` on the repository remote. Plain push, so only a
 * fast-forward lands; the branch the workspace checks out is refused.
 */
export const pushWorkspaceBranch = async (
  runtime: WorkspaceRuntime,
  request: Agent.WorkspaceRequest,
  refs: Agent.WorkspaceRef[],
  repoName: string,
  branch: string
): Promise<void> => {
  const repo = runtime.workspace.repos.find(({ name }) => name === repoName);
  const repoDir = request.repos[repoName]?.path;
  const ref = refs.find((entry) => entry.repo === repoName);

  if (!repo || !repoDir) throw new Error(`Repository '${repoName}' is not in the workspace`);
  if (!ref) throw new Error(`Repository '${repoName}' has no published commit`);

  const git = runtime.git ?? defaultGit;
  const formatResult = await git(['check-ref-format', '--branch', branch], { cwd: repoDir });

  if (formatResult.exitCode !== 0 || formatResult.stdout.trim() !== branch) {
    throw new Error(`Invalid branch name '${branch}'`);
  }
  if (branch === (repo.branch || 'main')) {
    throw new Error(`Refusing to push the workspace branch '${branch}' of '${repoName}'`);
  }

  const token = runtime.token ? await runtime.token() : undefined;
  const env = token ? authEnv(repo.url, token) : undefined;
  const pushResult = await git(['push', repo.url, `${ref.head}:refs/heads/${branch}`], { cwd: repoDir, env });

  if (pushResult.exitCode !== 0) {
    throw new Error(redact(pushResult.stderr || pushResult.stdout || 'git push failed', token));
  }
};
