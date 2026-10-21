import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { equal, throws, deepEqual, rejects } from 'node:assert/strict';
import { SchemaType } from '@ez4/schema';
import { AgentProvider, AgentToolsMode } from '@ez4/agent';

import { readAgentEnvironment, startAgent, MissingAgentEnvironmentError } from '../src/runtime/entry';

const schema = { type: SchemaType.Object, properties: { text: { type: SchemaType.String } } } as const;

const definition = {
  name: 'EchoAgent',
  provider: AgentProvider.Claude,
  model: 'm',
  instructions: 'echo',
  tools: { mode: AgentToolsMode.Readonly },
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

  it('assert :: startAgent reads the exported grants and writes the registry auth', async () => {
    const files: Record<string, unknown> = { 'invocations/EchoAgent/id-2.json': { input: { text: 'hi' } } };
    const home = await mkdtemp(join(tmpdir(), 'registry-entry-'));
    const grants = [{ domain: 'gaio', repository: 'npm', region: 'us-east-1', accountId: '010928226197' }];
    try {
      const code = await startAgent(
        definition,
        [async () => ({ prompt: 'hi' })],
        {},
        {
          EZ4_AGENT_NAME: 'EchoAgent',
          EZ4_AGENT_ID: 'id-2',
          EZ4_AGENT_BUCKET: 'b',
          EZ4_AGENT_TIMEOUT: '60',
          EZ4_AGENT_CODEARTIFACT: JSON.stringify(grants),
          HOME: home
        },
        {
          storage: memoryStorage(files),
          provider: { run: async () => ({ output: { text: 'ok' } }) } as never,
          registry: { grants, getToken: async () => 'tok-2', home }
        }
      );

      equal(code, 0);
      equal(
        await readFile(join(home, '.npmrc'), 'utf8'),
        '//gaio-010928226197.d.codeartifact.us-east-1.amazonaws.com/npm/npm/:_authToken=tok-2\n'
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('assert :: startAgent writes no registry auth without grants', async () => {
    const files: Record<string, unknown> = { 'invocations/EchoAgent/id-3.json': { input: { text: 'hi' } } };
    const home = await mkdtemp(join(tmpdir(), 'registry-entry-'));
    try {
      const code = await startAgent(
        definition,
        [async () => ({ prompt: 'hi' })],
        {},
        { EZ4_AGENT_NAME: 'EchoAgent', EZ4_AGENT_ID: 'id-3', EZ4_AGENT_BUCKET: 'b', EZ4_AGENT_TIMEOUT: '60', HOME: home },
        { storage: memoryStorage(files), provider: { run: async () => ({ output: { text: 'ok' } }) } as never }
      );

      equal(code, 0);
      await rejects(readFile(join(home, '.npmrc'), 'utf8'));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
