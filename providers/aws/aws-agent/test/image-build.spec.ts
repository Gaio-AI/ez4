import type { EcrImageClient } from '../src/image/types';
import { describe, it } from 'node:test';
import { ok, equal, rejects } from 'node:assert/strict';
import { buildAndPushImage } from '../src/image/build';
import { MissingDockerCliError } from '../src/image/errors';

describe('agent image builder', () => {
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
      agentName: 'TestAgent',
      repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-test-agent',
      dockerfile: 'FROM node:24-bookworm-slim',
      bundleHash: 'abc12345',
      workDir: '/tmp',
      client: mockClient,
      commandRunner: mockRunner
    });

    equal(checkedRepo, 'ez4-test-agent');
    ok(checkedTag.length > 0);
    equal(buildExecuted, false);
    equal(imageUri, `123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-test-agent:${checkedTag}`);
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
      agentName: 'TestAgent',
      repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-test-agent',
      dockerfile: 'FROM node:24-bookworm-slim',
      bundleHash: 'abc12345',
      workDir: '/tmp/agent-build',
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
          agentName: 'TestAgent',
          repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-test-agent',
          dockerfile: 'FROM node:24-bookworm-slim',
          bundleHash: 'abc12345',
          workDir: '/tmp'
        });
      }, MissingDockerCliError);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
