import { createSign } from 'node:crypto';

export const createGitHubAppJwt = (appId: string, privateKeyPem: string, nowSeconds = Math.floor(Date.now() / 1000)): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: appId
    })
  ).toString('base64url');

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKeyPem, 'base64url');
  return `${header}.${payload}.${signature}`;
};

export const mintInstallationToken = async (params: {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  /**
   * What the token may do with the repository contents. Read is enough to clone and fetch; only the push of a finished
   * branch asks for write.
   */
  access?: 'read' | 'write';
  fetch?: typeof fetch;
  now?: () => number;
}): Promise<string> => {
  const {
    appId,
    installationId,
    privateKeyPem,
    access = 'read',
    fetch: fetchFn = globalThis.fetch,
    now = () => Math.floor(Date.now() / 1000)
  } = params;

  const jwt = createGitHubAppJwt(appId, privateKeyPem, now());
  const response = await fetchFn(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      permissions: { contents: access }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub App token mint failed with status ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { token: string };
  return data.token;
};

export type GitIdentity = { name: string; email: string };

/**
 * The commit identity GitHub attributes to the App: `<slug>[bot]` with the noreply address built from the bot user id.
 */
export const resolveAppIdentity = async (params: {
  appId: string;
  privateKeyPem: string;
  fetch?: typeof fetch;
  now?: () => number;
}): Promise<GitIdentity> => {
  const { appId, privateKeyPem, fetch: fetchFn = globalThis.fetch, now = () => Math.floor(Date.now() / 1000) } = params;

  const get = async <T>(path: string, authorization?: string): Promise<T> => {
    const response = await fetchFn(`https://api.github.com${path}`, {
      headers: {
        ...(authorization && { Authorization: authorization }),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response.ok) {
      throw new Error(`GitHub App identity lookup failed with status ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  };

  const { slug } = await get<{ slug: string }>('/app', `Bearer ${createGitHubAppJwt(appId, privateKeyPem, now())}`);
  const name = `${slug}[bot]`;
  const { id } = await get<{ id: number }>(`/users/${encodeURIComponent(name)}`);

  return { name, email: `${id}+${name}@users.noreply.github.com` };
};

export const gitIdentityEnv = ({ name, email }: GitIdentity): Record<string, string> => ({
  GIT_AUTHOR_NAME: name,
  GIT_AUTHOR_EMAIL: email,
  GIT_COMMITTER_NAME: name,
  GIT_COMMITTER_EMAIL: email
});
