import type { KeyProvider } from '../src/client/envelope';

import { describe, it } from 'node:test';
import { equal, notEqual, ok, rejects } from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { Client, MalformedCiphertextError, UnexpectedKeySourceError } from '@ez4/aws-kms/client';

import { createEnvelopeClient } from '../src/client/envelope';
import { createLocalKeyProvider } from '../src/client/local';

const countingProvider = () => {
  const local = createLocalKeyProvider();
  const calls = { generate: 0, decrypt: 0 };

  const provider: KeyProvider = {
    source: 'local',
    generateDataKey: () => {
      calls.generate++;
      return local.generateDataKey();
    },
    decryptDataKey: (encrypted) => {
      calls.decrypt++;
      return local.decryptDataKey(encrypted);
    }
  };

  return { provider, calls };
};

describe('encryption client', () => {
  it('assert :: encrypts and decrypts a value', async () => {
    const client = Client.makeLocal();

    const ciphertext = await client.encrypt('sk-secret-key');

    ok(ciphertext.startsWith('ez4e1.local.'));
    equal(ciphertext.split('.').length, 5);
    equal(ciphertext.includes('sk-secret-key'), false);

    equal(await client.decrypt(ciphertext), 'sk-secret-key');
  });

  it('assert :: never produces the same value twice', async () => {
    const client = Client.makeLocal();

    notEqual(await client.encrypt('same'), await client.encrypt('same'));
  });

  it('assert :: decrypts what another client of the same source sealed', async () => {
    const ciphertext = await Client.makeLocal().encrypt('shared', { accountId: 'a1' });

    equal(await Client.makeLocal().decrypt(ciphertext, { accountId: 'a1' }), 'shared');
  });

  it('assert :: binds a value to its context, in any key order', async () => {
    const client = Client.makeLocal();

    const ciphertext = await client.encrypt('bound', { accountId: 'a1', purpose: 'agent' });

    equal(await client.decrypt(ciphertext, { purpose: 'agent', accountId: 'a1' }), 'bound');

    await rejects(client.decrypt(ciphertext, { accountId: 'a2', purpose: 'agent' }));
    await rejects(client.decrypt(ciphertext));
  });

  it('assert :: refuses a value that was changed', async () => {
    const client = Client.makeLocal();

    const [version, source, dataKey, iv, ciphertext] = (await client.encrypt('value')).split('.');
    const changed = Buffer.from(ciphertext!, 'base64url');

    changed[0] = changed[0]! ^ 1;

    await rejects(client.decrypt([version, source, dataKey, iv, changed.toString('base64url')].join('.')));
  });

  it('assert :: refuses a value it does not produce', async () => {
    const client = Client.makeLocal();

    await rejects(client.decrypt('sk-plain-key'), MalformedCiphertextError);
    await rejects(client.decrypt(`ez4e2.local.${randomBytes(8).toString('base64url')}.a.b`), MalformedCiphertextError);

    const [version, source, dataKey, , ciphertext] = (await client.encrypt('value')).split('.');

    await rejects(
      client.decrypt([version, source, dataKey, randomBytes(8).toString('base64url'), ciphertext].join('.')),
      MalformedCiphertextError
    );
  });

  it('assert :: refuses a value sealed by another key source', async () => {
    const ciphertext = await Client.makeLocal().encrypt('local value');

    await rejects(Client.make({ keyId: 'alias/never-called' }).decrypt(ciphertext), UnexpectedKeySourceError);
  });

  it('assert :: draws one data key and opens each data key once', async () => {
    const { provider, calls } = countingProvider();
    const client = createEnvelopeClient(provider);

    const first = await client.encrypt('one');
    const second = await client.encrypt('two');

    equal(calls.generate, 1);

    const { provider: readerProvider, calls: readerCalls } = countingProvider();
    const reader = createEnvelopeClient(readerProvider);

    equal(await reader.decrypt(first), 'one');
    equal(await reader.decrypt(second), 'two');

    equal(readerCalls.decrypt, 1);
  });

  it('assert :: draws a data key again after the provider failed', async () => {
    const { provider, calls } = countingProvider();
    const generate = provider.generateDataKey;

    provider.generateDataKey = () => {
      provider.generateDataKey = generate;
      return Promise.reject(new Error('throttled'));
    };

    const client = createEnvelopeClient(provider);

    await rejects(client.encrypt('first'));

    ok(await client.encrypt('second'));
    equal(calls.generate, 1);
  });
});
