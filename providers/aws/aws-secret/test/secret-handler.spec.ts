import { describe, it } from 'node:test';
import { ok, deepEqual } from 'node:assert/strict';
import type { EntryStates, StepContext } from '@ez4/state';
import { createSecret, getSecretHandler, type SecretState } from '../src/main';

const fakeSecretState = (parameters: { secretName: string; retain?: boolean }): SecretState => ({
  entryId: 'secret-1',
  type: 'aws:secretsmanager.secret',
  dependencies: [],
  parameters: {
    secretName: parameters.secretName,
    retain: parameters.retain
  }
});

const fakeContext = (): StepContext =>
  ({
    getDependencies: () => [],
    getStepState: () => undefined
  }) as unknown as StepContext;

describe('Secrets Manager secret handler', () => {
  it('assert :: value never reaches state', async () => {
    const state: EntryStates = {};
    const secret = createSecret(state, { secretName: 'stg/agents/claude', getSecretValue: async () => ({ TOKEN: 'sk-1' }) });
    ok(!JSON.stringify(secret).includes('sk-1'));
  });

  it('assert :: retained secret is not deleted on destroy', async () => {
    const deleted: string[] = [];
    const handler = getSecretHandler({ remove: async (name) => void deleted.push(name) });
    await handler.delete(fakeSecretState({ secretName: 'stg/agents/claude', retain: true }), fakeContext());
    deepEqual(deleted, []);
  });
});
