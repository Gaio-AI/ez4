import { describe, it, mock } from 'node:test';
import { equal, deepEqual, rejects, ok } from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRegistryGrants,
  registryHost,
  renderNpmrc,
  writeRegistryAuth,
  RegistryAuthError,
  type RegistryGrant
} from '../src/runtime/registry';

const grant: RegistryGrant = { domain: 'gaio', repository: 'npm', region: 'us-east-1', accountId: '010928226197' };

describe('runtime :: registry auth', () => {
  it('assert :: reads no grants when the variable is absent or empty', () => {
    deepEqual(readRegistryGrants({}), []);
    deepEqual(readRegistryGrants({ EZ4_AGENT_CODEARTIFACT: '' }), []);
  });

  it('assert :: reads the grants the task definition exports', () => {
    deepEqual(readRegistryGrants({ EZ4_AGENT_CODEARTIFACT: JSON.stringify([grant]) }), [grant]);
  });

  it('assert :: names the npm endpoint of the repository', () => {
    equal(registryHost(grant), 'gaio-010928226197.d.codeartifact.us-east-1.amazonaws.com');
  });

  it('assert :: renders one auth line per grant and nothing else', () => {
    equal(
      renderNpmrc([{ grant, token: 'tok-1' }]),
      '//gaio-010928226197.d.codeartifact.us-east-1.amazonaws.com/npm/npm/:_authToken=tok-1\n'
    );
  });

  it('assert :: writes ~/.npmrc with mode 600', async () => {
    const home = await mkdtemp(join(tmpdir(), 'registry-'));
    try {
      await writeRegistryAuth([grant], async () => 'tok-1', home);
      equal(await readFile(join(home, '.npmrc'), 'utf8'), renderNpmrc([{ grant, token: 'tok-1' }]));
      equal((await stat(join(home, '.npmrc'))).mode & 0o777, 0o600);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('assert :: asks for nothing and writes nothing without grants', async () => {
    const home = await mkdtemp(join(tmpdir(), 'registry-'));
    let asked = false;
    try {
      await writeRegistryAuth([], async () => ((asked = true), 'x'), home);
      equal(asked, false);
      await rejects(stat(join(home, '.npmrc')));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('assert :: a failed token request names the grant and keeps the token out of the message', async () => {
    const home = await mkdtemp(join(tmpdir(), 'registry-'));
    try {
      await rejects(
        writeRegistryAuth([grant], async () => Promise.reject(new Error('AccessDenied')), home),
        (error: unknown) => {
          ok(error instanceof RegistryAuthError);
          equal(error.grant, grant);
          equal(error.message, 'CodeArtifact token request failed for gaio/npm: AccessDenied');
          return true;
        }
      );
      await rejects(stat(join(home, '.npmrc')));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

import { createRegistryTokenSource } from '../src/runtime/registry-token';

describe('runtime :: registry token source', () => {
  it('assert :: asks the grant domain for a token owned by the account', async () => {
    const sent: unknown[] = [];
    const source = createRegistryTokenSource(() => ({
      send: (async (command: { input: unknown }) => (sent.push(command.input), { authorizationToken: 'tok-9' })) as never
    }));

    equal(await source(grant), 'tok-9');
    deepEqual(sent, [{ domain: 'gaio', domainOwner: '010928226197' }]);
  });

  it('assert :: an empty answer is an error', async () => {
    const source = createRegistryTokenSource(() => ({ send: (async () => ({})) as never }));
    await rejects(source(grant), /returned no token/);
  });

  it('assert :: the token request uses fetch, which follows the egress proxy', async () => {
    const saved = { ...process.env };
    delete process.env.AWS_ENDPOINT_URL;
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    const urls: string[] = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (input: unknown) => {
      urls.push(String((input as { url?: string }).url ?? input));
      return new Response(JSON.stringify({ authorizationToken: 'tok-fetch', expiration: 1.8e9 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    try {
      equal(await createRegistryTokenSource()(grant), 'tok-fetch');
      equal(urls.length, 1);
      ok(urls[0]!.startsWith('https://codeartifact.us-east-1.amazonaws.com/'));
    } finally {
      fetchMock.mock.restore();
      for (const name of ['AWS_ENDPOINT_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });
});
