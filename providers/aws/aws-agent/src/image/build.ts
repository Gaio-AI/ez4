import type { ImageBuildOptions } from './types';

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import { MissingDockerCliError } from './errors';
import { checkImageExists, fetchAuthorizationToken } from './client';
import { computeImageTag } from './dockerfile';

export const isDockerAvailable = (): boolean => {
  const pathEnv = process.env.PATH ?? '';
  const paths = pathEnv.split(delimiter);

  for (const dir of paths) {
    if (existsSync(`${dir}/docker`)) {
      return true;
    }
  }

  return false;
};

const defaultCommandRunner = (command: string, args: string[], options?: { input?: string; cwd?: string }): Promise<void> => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const child = spawn(command, args, {
    cwd: options?.cwd,
    stdio: [options?.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe']
  });

  let stderr = '';

  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  if (options?.input !== undefined && child.stdin) {
    child.stdin.write(options.input);
    child.stdin.end();
  }

  child.on('error', (err) => reject(err));
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`Command ${command} ${args.join(' ')} exited with code ${code}: ${stderr}`));
    }
  });

  return promise;
};

export const buildAndPushImage = async (options: ImageBuildOptions): Promise<string> => {
  const { repositoryUri, dockerfile, bundleHash, workDir, client, commandRunner = defaultCommandRunner } = options;

  if (!isDockerAvailable()) {
    throw new MissingDockerCliError();
  }

  const imageTag = computeImageTag(dockerfile, bundleHash);
  // Extract repositoryName from repositoryUri (e.g., 123456789.dkr.ecr.us-east-1.amazonaws.com/my-repo -> my-repo)
  const slashIndex = repositoryUri.indexOf('/');
  const repositoryName = slashIndex >= 0 ? repositoryUri.substring(slashIndex + 1) : repositoryUri;
  const registryUri = slashIndex >= 0 ? repositoryUri.substring(0, slashIndex) : repositoryUri;

  const exists = client ? await client.imageExists(repositoryName, imageTag) : await checkImageExists(repositoryName, imageTag);

  const fullImageUri = `${repositoryUri}:${imageTag}`;

  if (exists) {
    return fullImageUri;
  }

  const authData = client ? await client.getAuthorizationToken() : await fetchAuthorizationToken();

  if (authData.authorizationToken) {
    const decoded = Buffer.from(authData.authorizationToken, 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    const password = colonIndex >= 0 ? decoded.substring(colonIndex + 1) : decoded;

    await commandRunner('docker', ['login', '--username', 'AWS', '--password-stdin', registryUri], {
      input: password
    });
  }

  await commandRunner('docker', ['buildx', 'build', '--platform', 'linux/amd64', '-t', fullImageUri, '--push', '.'], { cwd: workDir });

  return fullImageUri;
};
