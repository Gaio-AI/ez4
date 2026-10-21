import { describe, it } from 'node:test';
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
