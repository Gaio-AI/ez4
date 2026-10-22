import type { AgentService } from '@ez4/agent/library';
import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { generateDockerfile, computeImageTag } from '../src/image/dockerfile';
import { ServiceType } from '@ez4/agent/library';

describe('agent dockerfile generator', () => {
  it('assert :: generates valid Dockerfile with base, user 1000, and declared packages', () => {
    const dummyAgent = {
      type: ServiceType,
      name: 'ImplementAgent',
      image: {
        base: 'public.ecr.aws/docker/library/node:24-bookworm-slim',
        aptPackages: ['git', 'procps'],
        npmPackages: ['@anthropic-ai/claude-agent-sdk', 'typescript']
      },
      variables: {},
      services: {}
    } as unknown as AgentService;

    const dockerfile = generateDockerfile(dummyAgent);

    ok(dockerfile.includes('FROM public.ecr.aws/docker/library/node:24-bookworm-slim'));
    ok(dockerfile.includes('apt-get update && apt-get install -y --no-install-recommends git procps'));
    ok(dockerfile.includes('RUN npm install --omit=dev --prefix /app @anthropic-ai/claude-agent-sdk typescript\n'));
    ok(!dockerfile.includes('npm install -g'));
    ok(dockerfile.includes('COPY --chown=1000:1000 runtime.mjs /app/runtime.mjs'));
    ok(dockerfile.includes('RUN id -u 1000 >/dev/null 2>&1 || useradd -u 1000 -m -s /bin/bash ez4'));
    ok(dockerfile.includes('USER 1000'));
    ok(dockerfile.includes('ENTRYPOINT ["node", "/app/runtime.mjs"]'));

    // The process starts in the last WORKDIR, where the workspace is checked out as uid 1000.
    const workdirs = dockerfile.split('\n').filter((line) => line.startsWith('WORKDIR '));
    equal(workdirs.at(-1), 'WORKDIR /work');
    ok(dockerfile.indexOf('chown 1000:1000 /work') < dockerfile.lastIndexOf('WORKDIR /work'));
  });

  it('assert :: the binaries of the installed packages are on PATH', () => {
    const dockerfile = generateDockerfile({
      type: ServiceType,
      name: 'ToolAgent',
      image: { npmPackages: ['pnpm@10.33.0'] }
    } as unknown as AgentService);

    ok(dockerfile.includes('ENV PATH=/app/node_modules/.bin:$PATH\n'));
    ok(dockerfile.indexOf('ENV PATH=') < dockerfile.indexOf('USER 1000'));
  });

  it('assert :: an agent with a workspace gets git once, even when it also declares it', () => {
    const withWorkspace = {
      type: ServiceType,
      name: 'WorkspaceAgent',
      workspace: { repos: [{ url: 'https://github.com/org/repo.git' }] },
      image: { aptPackages: ['git', 'jq'] }
    } as unknown as AgentService;

    ok(generateDockerfile(withWorkspace).includes('apt-get install -y --no-install-recommends git ca-certificates jq &&'));

    const withoutWorkspace = { type: ServiceType, name: 'PlainAgent' } as unknown as AgentService;
    ok(!generateDockerfile(withoutWorkspace).includes('apt-get'));
  });

  it('assert :: computes deterministic tag from dockerfile and bundle hash', () => {
    const tag1 = computeImageTag('FROM public.ecr.aws/docker/library/node:24-bookworm-slim', 'hash123');
    const tag2 = computeImageTag('FROM public.ecr.aws/docker/library/node:24-bookworm-slim', 'hash123');
    const tag3 = computeImageTag('FROM public.ecr.aws/docker/library/node:24-bookworm-slim', 'hash456');

    equal(tag1, tag2);
    ok(tag1 !== tag3);
    equal(tag1.length, 64);
  });
});
