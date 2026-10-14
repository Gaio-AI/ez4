import type { AgentService } from '@ez4/agent/library';
import { createHash } from 'node:crypto';

export const generateDockerfile = (agent: AgentService): string => {
  const base = agent.image?.base ?? 'public.ecr.aws/docker/library/node:24-bookworm-slim';
  const aptPackages = (agent.image?.aptPackages ?? []).join(' ');
  const npmPackages = (agent.image?.npmPackages ?? []).join(' ');

  const lines: string[] = [`FROM ${base}`, 'WORKDIR /app', 'ENV NODE_ENV=production'];

  if (aptPackages) {
    lines.push(`RUN apt-get update && apt-get install -y --no-install-recommends ${aptPackages} && rm -rf /var/lib/apt/lists/*`);
  }

  lines.push(
    `RUN npm install --omit=dev --prefix /app @anthropic-ai/claude-agent-sdk @aws-sdk/client-s3${npmPackages ? ` ${npmPackages}` : ''}`
  );

  lines.push(
    // node images already ship uid/gid 1000 (`node`); create it only on bases that lack it.
    'RUN id -u 1000 >/dev/null 2>&1 || useradd -u 1000 -m -s /bin/bash ez4',
    'COPY --chown=1000:1000 runtime.mjs /app/runtime.mjs',
    'USER 1000',
    'ENTRYPOINT ["node", "/app/runtime.mjs"]'
  );

  return lines.join('\n');
};

export const computeImageTag = (dockerfile: string, bundleHash: string): string => {
  return createHash('sha256').update(dockerfile).update(bundleHash).digest('hex');
};
