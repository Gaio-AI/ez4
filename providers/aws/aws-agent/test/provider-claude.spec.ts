import type { AgentProviderRequest } from '../src/runtime/types';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { describe, it } from 'node:test';
import { equal, deepEqual, ok, rejects } from 'node:assert/strict';
import { ClaudeAgentProvider } from '../src/runtime/providers/claude';

type SdkQueryFunction = typeof query;

interface MockQueryParams {
  prompt: unknown;
  options: {
    model?: string;
    systemPrompt?: string;
    cwd?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    permissionMode?: string;
    allowDangerouslySkipPermissions?: boolean;
    outputFormat?: {
      type: string;
      schema: Record<string, unknown>;
    };
    abortController?: AbortController;
    env?: Record<string, string | undefined>;
  };
}

describe('runtime :: claude provider', () => {
  it('maps tools.mode "edit" to bypassPermissions with allowDangerouslySkipPermissions true', async () => {
    let capturedParams: MockQueryParams | null = null;

    const mockQueryRunner = async function* (params: unknown) {
      capturedParams = params as MockQueryParams;
      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: 1200,
        total_cost_usd: 0.042,
        structured_output: { answer: '42' },
        usage: { input_tokens: 150, output_tokens: 50 },
        is_error: false
      };
    };

    const provider = new ClaudeAgentProvider({
      queryRunner: mockQueryRunner as unknown as SdkQueryFunction
    });
    const abortController = new AbortController();

    const request: AgentProviderRequest = {
      model: 'claude-3-7-sonnet-20250219',
      instructions: 'You are an autonomous implementer.',
      prompt: 'Implement feature X',
      workdir: '/workspace',
      tools: {
        mode: 'edit',
        allowed: ['Bash', 'Read', 'Edit']
      },
      mcpServers: {
        github: { command: 'node', args: ['/opt/mcp/github.js'] }
      },
      outputSchema: {
        type: 'object',
        properties: { answer: { type: 'string' } }
      },
      env: { GITHUB_TOKEN: 'secret' },
      signal: abortController.signal
    };

    const response = await provider.run(request);

    ok(capturedParams !== null);
    const params = capturedParams as MockQueryParams;
    equal(params.prompt, 'Implement feature X');
    equal(params.options.model, 'claude-3-7-sonnet-20250219');
    equal(params.options.systemPrompt, 'You are an autonomous implementer.');
    equal(params.options.cwd, '/workspace');
    deepEqual(params.options.allowedTools, ['Bash', 'Read', 'Edit']);
    ok(params.options.disallowedTools?.includes('AskUserQuestion'));
    equal(params.options.permissionMode, 'bypassPermissions');
    equal(params.options.allowDangerouslySkipPermissions, true);
    deepEqual(params.options.outputFormat, {
      type: 'json_schema',
      schema: { type: 'object', properties: { answer: { type: 'string' } } }
    });

    deepEqual(response.output, { answer: '42' });
    deepEqual(response.usage, { inputTokens: 150, outputTokens: 50 });
  });

  it('maps tools.mode "readonly" to dontAsk mode and restrains tools to tools.allowed', async () => {
    let capturedParams: MockQueryParams | null = null;

    const mockQueryRunner = async function* (params: unknown) {
      capturedParams = params as MockQueryParams;
      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: 800,
        structured_output: { verdict: 'approved' },
        usage: { input_tokens: 100, output_tokens: 20 },
        is_error: false
      };
    };

    const provider = new ClaudeAgentProvider({
      queryRunner: mockQueryRunner as unknown as SdkQueryFunction
    });
    const request: AgentProviderRequest = {
      model: 'claude-3-7-sonnet-20250219',
      instructions: 'You are an auditor.',
      prompt: 'Review diff',
      workdir: '/workspace',
      tools: {
        mode: 'readonly',
        allowed: ['Read', 'Grep', 'Glob']
      },
      mcpServers: {},
      outputSchema: {
        type: 'object',
        properties: { verdict: { type: 'string' } }
      },
      env: {},
      signal: new AbortController().signal
    };

    const response = await provider.run(request);

    ok(capturedParams !== null);
    const params = capturedParams as MockQueryParams;
    equal(params.prompt, 'Review diff');
    equal(params.options.permissionMode, 'dontAsk');
    equal(params.options.allowDangerouslySkipPermissions, undefined);
    deepEqual(params.options.allowedTools, ['Read', 'Grep', 'Glob']);
    ok(params.options.disallowedTools?.includes('AskUserQuestion'));

    deepEqual(response.output, { verdict: 'approved' });
  });

  it('throws error when query result indicates failure', async () => {
    const mockQueryRunner = async function* () {
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        duration_ms: 500
      };
    };

    const provider = new ClaudeAgentProvider({
      queryRunner: mockQueryRunner as unknown as SdkQueryFunction
    });
    await rejects(
      provider.run({
        model: 'claude-3-7-sonnet-20250219',
        instructions: 'Test',
        prompt: 'test',
        workdir: '/tmp',
        tools: { mode: 'readonly' },
        mcpServers: {},
        outputSchema: {},
        env: {},
        signal: new AbortController().signal
      }),
      /Claude agent execution failed/
    );
  });

  it('propagates signal abort to abortController', async () => {
    let capturedAbortController: AbortController | undefined;

    const mockQueryRunner = async function* (params: unknown) {
      const mockParams = params as MockQueryParams;
      capturedAbortController = mockParams.options.abortController;
      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: 100,
        structured_output: null,
        is_error: false
      };
    };

    const provider = new ClaudeAgentProvider({
      queryRunner: mockQueryRunner as unknown as SdkQueryFunction
    });

    const parentAbortController = new AbortController();
    const runPromise = provider.run({
      model: 'claude-3-7-sonnet-20250219',
      instructions: 'Test',
      prompt: 'test',
      workdir: '/tmp',
      tools: { mode: 'readonly' },
      mcpServers: {},
      outputSchema: {},
      env: {},
      signal: parentAbortController.signal
    });

    parentAbortController.abort();
    await runPromise;

    ok(capturedAbortController);
    equal(capturedAbortController.signal.aborted, true);
  });
});
