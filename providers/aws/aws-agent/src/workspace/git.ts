import { spawn } from 'node:child_process';

export type Git = (
  args: string[],
  options: { cwd: string; env?: Record<string, string> }
) => Promise<{ stdout: string; exitCode: number; stderr: string }>;

export const defaultGit: Git = (args, options) => {
  const { promise, resolve, reject } = Promise.withResolvers<{ stdout: string; exitCode: number; stderr: string }>();

  const child = spawn('git', args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
      GIT_TERMINAL_PROMPT: '0'
    }
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout?.on('data', (chunk) => stdoutChunks.push(chunk));
  child.stderr?.on('data', (chunk) => stderrChunks.push(chunk));

  child.on('error', (err) => reject(err));

  child.on('close', (code) => {
    resolve({
      stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
      stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      exitCode: code ?? 1
    });
  });

  return promise;
};
