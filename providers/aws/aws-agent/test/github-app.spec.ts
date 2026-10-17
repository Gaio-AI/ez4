import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mintInstallationToken, createGitHubAppJwt } from '../src/workspace/github';

describe('workspace :: github app', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const testKey = privateKey;

  it('assert :: installation token is requested read-only', async () => {
    const requests: { url: string; body: string }[] = [];
    const token = await mintInstallationToken({
      appId: '1',
      installationId: '2',
      privateKeyPem: testKey,
      now: () => 1_700_000_000,
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: String(init?.body) });
        return new Response(JSON.stringify({ token: 'ghs_x' }), { status: 201 });
      }
    });
    deepEqual(token, 'ghs_x');
    deepEqual(requests[0].url, 'https://api.github.com/app/installations/2/access_tokens');
    deepEqual(JSON.parse(requests[0].body), { permissions: { contents: 'read' } });
  });

  it('assert :: installation token asks for write access when told to', async () => {
    const bodies: unknown[] = [];
    await mintInstallationToken({
      appId: '1',
      installationId: '2',
      privateKeyPem: testKey,
      access: 'write',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ token: 'ghs_w' }), { status: 201 });
      }
    });
    deepEqual(bodies, [{ permissions: { contents: 'write' } }]);
  });

  it('assert :: createGitHubAppJwt creates a valid JWT structure', () => {
    const jwt = createGitHubAppJwt('123', testKey, 1_700_000_000);
    const parts = jwt.split('.');
    deepEqual(parts.length, 3);
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    deepEqual(header, { alg: 'RS256', typ: 'JWT' });
    deepEqual(payload, { iat: 1_700_000_000 - 60, exp: 1_700_000_000 + 540, iss: '123' });
  });
});
