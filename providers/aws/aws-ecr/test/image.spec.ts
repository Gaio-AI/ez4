import type { EcrImageClient } from '../src/image/types';
import { describe, it } from 'node:test';
import { ok, equal, rejects, deepEqual } from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { buildAndPushImage } from '../src/image/build';
import { MissingDockerCliError } from '../src/image/errors';

describe('ECR image builder', () => {
  it('assert :: skips build and push when image tag already exists in ECR', async () => {
    let checkedRepo = '';
    let checkedTag = '';
    let buildExecuted = false;

    const mockClient: EcrImageClient = {
      imageExists: async (repo, tag) => {
        checkedRepo = repo;
        checkedTag = tag;
        return true;
      },
      getAuthorizationToken: async () => ({})
    };

    const mockRunner = async () => {
      buildExecuted = true;
    };

    const imageUri = await buildAndPushImage({
      imageName: 'TestAgent',
      repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-test-agent',
      dockerfile: 'FROM node:24-bookworm-slim',
      bundleHash: 'abc12345',
      bundleFile: import.meta.filename,
      client: mockClient,
      commandRunner: mockRunner
    });

    equal(checkedRepo, 'ez4-test-agent');
    ok(checkedTag.length > 0);
    equal(buildExecuted, false);
    equal(imageUri, `123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-test-agent:${checkedTag}`);
  });

  it('assert :: builds only from a Dockerfile and copied runtime bundle', async () => {
    let files: string[] = [];
    let runtime = '';
    let dockerfile = '';
    const client: EcrImageClient = {
      imageExists: async () => false,
      getAuthorizationToken: async () => ({})
    };
    await buildAndPushImage({
      imageName: 'TestAgent',
      repositoryUri: 'registry.example/test-agent',
      dockerfile: 'FROM node:24',
      bundleHash: 'abc12345',
      bundleFile: import.meta.filename,
      client,
      commandRunner: async (_command, args, options) => {
        if (args[0] !== 'buildx' || !options?.cwd) return;
        files = await readdir(options.cwd);
        runtime = await readFile(`${options.cwd}/runtime.mjs`, 'utf8');
        dockerfile = await readFile(`${options.cwd}/Dockerfile`, 'utf8');
      }
    });
    deepEqual(files, ['Dockerfile', 'runtime.mjs']);
    equal(runtime, await readFile(import.meta.filename, 'utf8'));
    equal(dockerfile, 'FROM node:24');
  });

  it('assert :: logs in and executes docker buildx when image does not exist', async () => {
    const executedCommands: { command: string; args: string[]; input?: string }[] = [];

    const mockClient: EcrImageClient = {
      imageExists: async () => false,
      getAuthorizationToken: async () => ({
        authorizationToken: Buffer.from('AWS:mock-ecr-token').toString('base64'),
        proxyEndpoint: 'https://123456789012.dkr.ecr.us-east-1.amazonaws.com'
      })
    };

    const mockRunner = async (command: string, args: string[], options?: { input?: string; cwd?: string }) => {
      executedCommands.push({ command, args, input: options?.input });
    };

    const imageUri = await buildAndPushImage({
      imageName: 'TestAgent',
      repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-test-agent',
      dockerfile: 'FROM node:24-bookworm-slim',
      bundleHash: 'abc12345',
      bundleFile: import.meta.filename,
      client: mockClient,
      commandRunner: mockRunner
    });

    equal(executedCommands.length, 2);

    // Docker login command
    equal(executedCommands[0].command, 'docker');
    equal(executedCommands[0].args[0], 'login');
    equal(executedCommands[0].input, 'mock-ecr-token');

    // Docker buildx command
    equal(executedCommands[1].command, 'docker');
    equal(executedCommands[1].args[0], 'buildx');
    equal(executedCommands[1].args[1], 'build');
    ok(executedCommands[1].args.includes('--push'));
    ok(executedCommands[1].args.includes(imageUri));
  });

  it('assert :: throws MissingDockerCliError when docker is not in PATH', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/non-existent-directory';

    try {
      await rejects(async () => {
        await buildAndPushImage({
          imageName: 'TestAgent',
          repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-test-agent',
          dockerfile: 'FROM node:24-bookworm-slim',
          bundleHash: 'abc12345',
          bundleFile: import.meta.filename
        });
      }, MissingDockerCliError);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
