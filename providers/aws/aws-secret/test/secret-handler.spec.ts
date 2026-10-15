import { describe, it } from 'node:test';
import { ok, deepEqual } from 'node:assert/strict';
import type { EntryStates, StepContext } from '@ez4/state';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createSecret, getSecretHandler, putSecretValue, setSecretsManagerClient, type SecretState } from '../src/main';

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

  it('assert :: an existing secret keeps its value, so a generated credential never rotates on update', async () => {
    const sent: string[] = [];
    let generated = 0;

    setSecretsManagerClient({
      send: async (command: { constructor: { name: string } }) => {
        sent.push(command.constructor.name);
        return { ARN: 'arn:aws:secretsmanager:us-east-1:123:secret:proxy-x' };
      }
    } as unknown as SecretsManagerClient);

    try {
      const state: EntryStates = {};
      const secret = createSecret(state, {
        secretName: 'proxy',
        getSecretValue: async () => ({ password: `generated-${++generated}` })
      });
      const current = { ...secret, result: { secretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:proxy-x' } };

      await getSecretHandler().update(current, current, fakeContext());

      deepEqual(sent, ['DescribeSecretCommand']);
      deepEqual(generated, 0);
    } finally {
      setSecretsManagerClient(null);
    }
  });

  it('assert :: an explicit put replaces the value of an existing secret', async () => {
    const sent: { name: string; input: unknown }[] = [];

    setSecretsManagerClient({
      send: async (command: { constructor: { name: string }; input: unknown }) => {
        sent.push({ name: command.constructor.name, input: command.input });
        return { ARN: 'arn:aws:secretsmanager:us-east-1:123:secret:claude-x' };
      }
    } as unknown as SecretsManagerClient);

    try {
      await putSecretValue('stg/agents/claude', { TOKEN: 'sk-2' });

      deepEqual(sent.at(-1), {
        name: 'PutSecretValueCommand',
        input: { SecretId: 'stg/agents/claude', SecretString: '{"TOKEN":"sk-2"}' }
      });
    } finally {
      setSecretsManagerClient(null);
    }
  });
});
