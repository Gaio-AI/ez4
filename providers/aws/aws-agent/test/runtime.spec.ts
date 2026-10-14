import { describe, it } from 'node:test';
import { equal, deepEqual, ok } from 'node:assert/strict';
import { runAgentRuntime } from '../src/runtime/main';
import type { AgentStorage } from '../src/runtime/storage';
import type { AgentProvider, AgentProviderRequest, AgentProviderResponse } from '../src/runtime/types';
import { SchemaType, type ObjectSchema } from '@ez4/schema';
import type { Agent } from '@ez4/agent';

describe('runtime :: execution lifecycle', () => {
  type TestAgentService = Agent.Service<{ task: string }, { result: string }>;

  const inputSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: { task: { type: SchemaType.String } }
  };
  const outputSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: { result: { type: SchemaType.String } }
  };

  it('runs complete lifecycle: prepare -> provider -> finish -> write result', async () => {
    const memory = new Map<string, string>();
    const storage: AgentStorage = {
      readJson: async <T>(key: string): Promise<T> => JSON.parse(memory.get(key) ?? 'null') as T,
      writeJson: async <T>(key: string, value: T): Promise<void> => {
        memory.set(key, JSON.stringify(value));
      },
      putBuffer: async (key: string, buffer: Uint8Array): Promise<void> => {
        memory.set(key, Buffer.from(buffer).toString('utf-8'));
      },
      getBuffer: async (key: string): Promise<Uint8Array | undefined> =>
        memory.has(key) ? Buffer.from(memory.get(key) ?? '', 'utf-8') : undefined
    };

    const invocationId = 'inv-123';
    const agentName = 'test-agent';
    await storage.writeJson(`invocations/${agentName}/${invocationId}.json`, {
      input: { task: 'hello' },
      correlation: JSON.stringify({ caller: 'unit-test' }),
      replyTo: 'https://sqs.us-east-1.amazonaws.com/123/queue.fifo'
    });

    let receivedPrompt = '';
    const fakeProvider: AgentProvider = {
      run: async (req: AgentProviderRequest): Promise<AgentProviderResponse> => {
        receivedPrompt = req.prompt;
        return {
          output: { result: `processed: ${req.prompt}` }
        };
      }
    };

    let prepareCalled = false;
    let finishCalled = false;
    const linkedContext = { review: { invoke: async () => ({ id: 'child' }) } };
    let prepareContext: unknown;
    let finishContext: unknown;

    const exitCode = await runAgentRuntime({
      agentName,
      invocationId,
      inputSchema,
      outputSchema,
      storage,
      provider: fakeProvider,
      tools: { mode: 'edit' },
      mcpServers: {},
      instructions: 'Do work',
      model: 'test-model',
      prepare: async (req: Agent.PrepareRequest<unknown>, context) => {
        prepareContext = context;
        prepareCalled = true;
        await req.artifacts.put('state.txt', 'started');
        const typedInput = req.input as { task: string };
        return { prompt: `custom prompt for ${typedInput.task}` };
      },
      finish: async (_req, context) => {
        finishContext = context;
        finishCalled = true;
        return { result: 'finished output' };
      },
      context: linkedContext,
      timeoutSeconds: 30
    });

    equal(exitCode, 0);
    ok(prepareCalled);
    ok(finishCalled);
    equal(prepareContext, linkedContext);
    equal(finishContext, linkedContext);
    equal(receivedPrompt, 'custom prompt for hello');

    const resultRaw = await storage.readJson<Agent.Result<TestAgentService>>(`results/${agentName}/${invocationId}.json`);
    equal(resultRaw.id, invocationId);
    equal(resultRaw.agent, agentName);
    equal(resultRaw.status, 'succeeded');
    deepEqual(resultRaw.output, { result: 'finished output' });
    equal(resultRaw.correlation, JSON.stringify({ caller: 'unit-test' }));
    ok(resultRaw.finishedAt);

    const artifactRaw = await storage.getBuffer(`artifacts/${agentName}/${invocationId}/state.txt`);
    ok(artifactRaw);
    equal(Buffer.from(artifactRaw).toString('utf-8'), 'started');
  });

  it('handles validation failure on input and writes failed result', async () => {
    const memory = new Map<string, string>();
    const storage: AgentStorage = {
      readJson: async <T>(key: string): Promise<T> => JSON.parse(memory.get(key) ?? 'null') as T,
      writeJson: async <T>(key: string, value: T): Promise<void> => {
        memory.set(key, JSON.stringify(value));
      },
      putBuffer: async (): Promise<void> => {},
      getBuffer: async (): Promise<Uint8Array | undefined> => undefined
    };

    const invocationId = 'inv-bad';
    const agentName = 'test-agent';
    await storage.writeJson(`invocations/${agentName}/${invocationId}.json`, {
      input: { invalidField: 123 },
      correlation: undefined
    });

    let providerCalled = false;
    const exitCode = await runAgentRuntime({
      agentName,
      invocationId,
      inputSchema,
      outputSchema,
      storage,
      provider: {
        run: async (): Promise<AgentProviderResponse> => {
          providerCalled = true;
          return { output: {} };
        }
      },
      tools: { mode: 'readonly' },
      mcpServers: {},
      instructions: 'Test',
      model: 'test',
      timeoutSeconds: 10
    });

    equal(exitCode, 1);
    equal(providerCalled, false);
    const result = await storage.readJson<Agent.Result<TestAgentService>>(`results/${agentName}/${invocationId}.json`);
    equal(result.status, 'failed');
    equal(result.error?.code, 'invalid_input');
    ok(result.error?.message.includes('Input validation failed'));
  });

  it('handles provider throwing and writes provider_error failed result', async () => {
    const memory = new Map<string, string>();
    const storage: AgentStorage = {
      readJson: async <T>(key: string): Promise<T> => JSON.parse(memory.get(key) ?? 'null') as T,
      writeJson: async <T>(key: string, value: T): Promise<void> => {
        memory.set(key, JSON.stringify(value));
      },
      putBuffer: async (): Promise<void> => {},
      getBuffer: async (): Promise<Uint8Array | undefined> => undefined
    };

    const invocationId = 'inv-prov-err';
    const agentName = 'test-agent';
    await storage.writeJson(`invocations/${agentName}/${invocationId}.json`, {
      input: { task: 'crash' },
      correlation: 'corr-crash'
    });

    const throwingProvider: AgentProvider = {
      run: async (): Promise<AgentProviderResponse> => {
        throw new Error('LLM service unavailable');
      }
    };

    const exitCode = await runAgentRuntime({
      agentName,
      invocationId,
      inputSchema,
      outputSchema,
      storage,
      provider: throwingProvider,
      tools: { mode: 'readonly' },
      mcpServers: {},
      instructions: 'Test',
      model: 'test',
      timeoutSeconds: 10
    });

    equal(exitCode, 1);
    const result = await storage.readJson<Agent.Result<TestAgentService>>(`results/${agentName}/${invocationId}.json`);
    equal(result.status, 'failed');
    equal(result.error?.code, 'provider_error');
    equal(result.error?.message, 'LLM service unavailable');
    equal(result.correlation, 'corr-crash');
  });

  it('handles validation failure on output and writes invalid_output result', async () => {
    const memory = new Map<string, string>();
    const storage: AgentStorage = {
      readJson: async <T>(key: string): Promise<T> => JSON.parse(memory.get(key) ?? 'null') as T,
      writeJson: async <T>(key: string, value: T): Promise<void> => {
        memory.set(key, JSON.stringify(value));
      },
      putBuffer: async (): Promise<void> => {},
      getBuffer: async (): Promise<Uint8Array | undefined> => undefined
    };

    const invocationId = 'inv-bad-out';
    const agentName = 'test-agent';
    await storage.writeJson(`invocations/${agentName}/${invocationId}.json`, {
      input: { task: 'ok' },
      correlation: 'corr-bad-out'
    });

    const badOutputProvider: AgentProvider = {
      run: async (): Promise<AgentProviderResponse> => ({
        output: { result: 12345 } // should be string
      })
    };

    const exitCode = await runAgentRuntime({
      agentName,
      invocationId,
      inputSchema,
      outputSchema,
      storage,
      provider: badOutputProvider,
      tools: { mode: 'readonly' },
      mcpServers: {},
      instructions: 'Test',
      model: 'test',
      timeoutSeconds: 10
    });

    equal(exitCode, 1);
    const result = await storage.readJson<Agent.Result<TestAgentService>>(`results/${agentName}/${invocationId}.json`);
    equal(result.status, 'failed');
    equal(result.error?.code, 'invalid_output');
    ok(result.error?.message.includes('Output validation failed'));
    equal(result.correlation, 'corr-bad-out');
  });

  it('handles timeout and writes timed_out result with aborted signal', async () => {
    const memory = new Map<string, string>();
    const storage: AgentStorage = {
      readJson: async <T>(key: string): Promise<T> => JSON.parse(memory.get(key) ?? 'null') as T,
      writeJson: async <T>(key: string, value: T): Promise<void> => {
        memory.set(key, JSON.stringify(value));
      },
      putBuffer: async (): Promise<void> => {},
      getBuffer: async (): Promise<Uint8Array | undefined> => undefined
    };

    const invocationId = 'inv-timeout';
    const agentName = 'test-agent';
    await storage.writeJson(`invocations/${agentName}/${invocationId}.json`, {
      input: { task: 'hang' },
      correlation: 'corr-timeout'
    });

    let receivedAbort = false;
    const hangingProvider: AgentProvider = {
      run: async (req: AgentProviderRequest): Promise<AgentProviderResponse> => {
        const { promise, reject } = Promise.withResolvers<AgentProviderResponse>();
        req.signal.addEventListener('abort', () => {
          receivedAbort = true;
          reject(new Error('Operation aborted'));
        });
        return promise;
      }
    };

    const exitCode = await runAgentRuntime({
      agentName,
      invocationId,
      inputSchema,
      outputSchema,
      storage,
      provider: hangingProvider,
      tools: { mode: 'readonly' },
      mcpServers: {},
      instructions: 'Test',
      model: 'test',
      timeoutSeconds: 0.05 // 50ms
    });

    equal(exitCode, 1);
    ok(receivedAbort);
    const result = await storage.readJson<Agent.Result<TestAgentService>>(`results/${agentName}/${invocationId}.json`);
    equal(result.status, 'timed_out');
    equal(result.error?.code, 'timeout');
    equal(result.correlation, 'corr-timeout');
  });
});
