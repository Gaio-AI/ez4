import { describe, it } from 'node:test';
import { equal, throws, deepEqual } from 'node:assert/strict';
import { SchemaType } from '@ez4/schema';

import { readAgentEnvironment, startAgent, MissingAgentEnvironmentError } from '../src/runtime/entry';

const schema = { type: SchemaType.Object, properties: { text: { type: SchemaType.String } } } as const;

const definition = {
  name: 'EchoAgent',
  provider: 'claude' as const,
  model: 'm',
  instructions: 'echo',
  tools: { mode: 'readonly' as const },
  mcpServers: {},
  inputSchema: schema,
  outputSchema: schema,
  timeout: 60,
  hooks: { prepare: 0, finish: -1 }
};

const memoryStorage = (files: Record<string, unknown>) => ({
  readJson: async <T>(key: string) => files[key] as T,
  writeJson: async (key: string, value: unknown) => void (files[key] = value),
  putBuffer: async () => undefined,
  getBuffer: async () => undefined
});

describe('agent container entrypoint', () => {
  it('assert :: reads the EZ4_AGENT_* environment', () => {
    deepEqual(readAgentEnvironment({ EZ4_AGENT_NAME: 'EchoAgent', EZ4_AGENT_ID: 'id-1', EZ4_AGENT_BUCKET: 'b', EZ4_AGENT_TIMEOUT: '60' }), {
      agentName: 'EchoAgent',
      invocationId: 'id-1',
      bucketName: 'b',
      timeoutSeconds: 60
    });
  });

  it('assert :: missing variable names it', () => {
    throws(
      () => readAgentEnvironment({ EZ4_AGENT_NAME: 'EchoAgent', EZ4_AGENT_BUCKET: 'b', EZ4_AGENT_TIMEOUT: '60' }),
      (error: unknown) => error instanceof MissingAgentEnvironmentError && error.message.includes('EZ4_AGENT_ID')
    );
  });

  it('assert :: runs the bundled prepare hook with the linked context and exits 0', async () => {
    const files: Record<string, unknown> = { 'invocations/EchoAgent/id-1.json': { input: { text: 'hi' } } };
    const linked = { review: { invoke: async () => ({ id: 'child' }) } };
    let seenContext: unknown;
    const prepare = async (request: { input: { text: string } }, context: unknown) => {
      seenContext = context;
      return { prompt: request.input.text };
    };
    const provider = { run: async (request: { prompt: string }) => ({ output: { text: request.prompt } }) };

    const code = await startAgent(
      definition,
      [prepare],
      linked,
      { EZ4_AGENT_NAME: 'EchoAgent', EZ4_AGENT_ID: 'id-1', EZ4_AGENT_BUCKET: 'b', EZ4_AGENT_TIMEOUT: '60' },
      { storage: memoryStorage(files), provider: provider as never }
    );

    equal(code, 0);
    equal(seenContext, linked);
    const result = files['results/EchoAgent/id-1.json'];
    deepEqual(result && typeof result === 'object' && 'output' in result && result.output, { text: 'hi' });
  });
});
