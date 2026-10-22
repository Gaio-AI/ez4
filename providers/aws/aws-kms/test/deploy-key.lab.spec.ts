import type { EntryState, EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';

import { createKey, isKeyState, registerTriggers } from '@ez4/aws-kms';
import { Client } from '@ez4/aws-kms/client';
import { deploy } from '@ez4/aws-common';
import { deepClone } from '@ez4/utils';

const ALIAS_NAME = 'alias/ez4-kms-test-key';

const assertDeploy = async <E extends EntryState>(resourceId: string, newState: EntryStates<E>, oldState: EntryStates<E> | undefined) => {
  const { result: state } = await deploy(newState, oldState, { force: true });

  const resource = state[resourceId];

  ok(resource?.result);
  ok(isKeyState(resource));

  const { keyId, keyArn } = resource.result;

  ok(keyId);
  ok(keyArn);

  return {
    result: resource.result,
    state
  };
};

describe('deploy key', { timeout: 120000 }, () => {
  let lastState: EntryStates | undefined;
  let keyId: string | undefined;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const resource = createKey(localState, {
      aliasName: ALIAS_NAME,
      description: 'EZ4 KMS key test',
      tags: {
        test1: 'ez4-tag1'
      }
    });

    keyId = resource.entryId;

    const { state } = await assertDeploy(keyId, localState, undefined);

    lastState = state;
  });

  it('assert :: encrypt and decrypt through the alias', async () => {
    const client = Client.make({ keyId: ALIAS_NAME });

    const ciphertext = await client.encrypt('sk-lab-secret', { accountId: 'lab' });

    ok(ciphertext.startsWith('ez4e1.kms.'));
    equal(await Client.make({ keyId: ALIAS_NAME }).decrypt(ciphertext, { accountId: 'lab' }), 'sk-lab-secret');
  });

  it('assert :: update description and tags', async () => {
    ok(keyId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[keyId];

    ok(resource && isKeyState(resource));

    resource.parameters.description = 'EZ4 KMS key test (updated)';
    resource.parameters.tags = {
      test1: 'ez4-tag1-updated',
      test2: 'ez4-tag2'
    };

    const { state } = await assertDeploy(keyId, localState, lastState);

    lastState = state;
  });

  it('assert :: destroy', async () => {
    ok(keyId && lastState);

    ok(lastState[keyId]);

    const { result } = await deploy(undefined, lastState, { force: true });

    equal(result[keyId], undefined);
  });
});
