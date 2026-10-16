import type { AgentService } from '@ez4/agent/library';
import { createHash } from 'node:crypto';

/**
 * Installed in the image and left out of the agent bundle; everything else, the AWS SDK included, is bundled.
 * The Claude SDK stays installed because it spawns the CLI shipped next to its own module.
 */
export const AGENT_IMAGE_PACKAGES = ['@anthropic-ai/claude-agent-sdk'];

export const generateDockerfile = (agent: AgentService): string => {
  const base = agent.image?.base ?? 'public.ecr.aws/docker/library/node:24-bookworm-slim';
  // Workspaces clone and push over HTTPS, which the slim base image cannot do on its own.
  const workspacePackages = agent.workspace ? ['git', 'ca-certificates'] : [];
  const aptPackages = [...new Set([...workspacePackages, ...(agent.image?.aptPackages ?? [])])].join(' ');

  const lines: string[] = [`FROM ${base}`, 'WORKDIR /app', 'ENV NODE_ENV=production'];

  if (aptPackages) {
    lines.push(`RUN apt-get update && apt-get install -y --no-install-recommends ${aptPackages} && rm -rf /var/lib/apt/lists/*`);
  }

  const npmPackages = new Set([...AGENT_IMAGE_PACKAGES, ...(agent.image?.npmPackages ?? [])]);

  lines.push(`RUN npm install --omit=dev --prefix /app ${[...npmPackages].join(' ')}`);

  lines.push(
    // node images already ship uid/gid 1000 (`node`); create it only on bases that lack it.
    'RUN id -u 1000 >/dev/null 2>&1 || useradd -u 1000 -m -s /bin/bash ez4',
    'COPY --chown=1000:1000 runtime.mjs /app/runtime.mjs',
    // The agent works (and checks out its workspace) in the current directory, which the agent user must own.
    'RUN mkdir -p /work && chown 1000:1000 /work',
    'WORKDIR /work',
    'USER 1000',
    'ENTRYPOINT ["node", "/app/runtime.mjs"]'
  );

  return lines.join('\n');
};

export const computeImageTag = (dockerfile: string, bundleHash: string): string => {
  return createHash('sha256').update(dockerfile).update(bundleHash).digest('hex');
};
