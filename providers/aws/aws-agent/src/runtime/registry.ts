import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const REGISTRY_GRANTS_ENV = 'EZ4_AGENT_CODEARTIFACT';

export type RegistryGrant = {
  domain: string;
  repository: string;
  region: string;
  accountId: string;
};

export type RegistryTokenSource = (grant: RegistryGrant) => Promise<string>;

export class RegistryAuthError extends Error {
  constructor(
    public grant: RegistryGrant,
    cause: unknown
  ) {
    super(
      `CodeArtifact token request failed for ${grant.domain}/${grant.repository}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

export const readRegistryGrants = (env: Record<string, string | undefined>): RegistryGrant[] => {
  const raw = env[REGISTRY_GRANTS_ENV];
  return raw ? (JSON.parse(raw) as RegistryGrant[]) : [];
};

export const registryHost = ({ domain, accountId, region }: RegistryGrant) =>
  `${domain}-${accountId}.d.codeartifact.${region}.amazonaws.com`;

export const renderNpmrc = (entries: ReadonlyArray<{ grant: RegistryGrant; token: string }>) =>
  entries.map(({ grant, token }) => `//${registryHost(grant)}/npm/${grant.repository}/:_authToken=${token}\n`).join('');

export const writeRegistryAuth = async (grants: readonly RegistryGrant[], getToken: RegistryTokenSource, home: string): Promise<void> => {
  if (grants.length === 0) return;

  const entries: Array<{ grant: RegistryGrant; token: string }> = [];
  for (const grant of grants) {
    try {
      entries.push({ grant, token: await getToken(grant) });
    } catch (error) {
      throw new RegistryAuthError(grant, error);
    }
  }

  const file = join(home, '.npmrc');
  await writeFile(file, renderNpmrc(entries), { mode: 0o600 });
  await chmod(file, 0o600);
};
