import type { AgentProvider, AgentProviderRequest, AgentProviderResponse } from '../types';
import { AgentToolsMode } from '@ez4/agent';
import { query as defaultQuery } from '@anthropic-ai/claude-agent-sdk';

export interface ClaudeProviderOptions {
  queryRunner?: typeof defaultQuery;
}

interface SdkUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface SdkResultMessage {
  type: string;
  subtype?: string;
  is_error?: boolean;
  structured_output?: unknown;
  result?: string;
  errors?: string[];
  usage?: SdkUsage;
}

export class ClaudeAgentProvider implements AgentProvider {
  private queryRunner: typeof defaultQuery;

  constructor(options?: ClaudeProviderOptions) {
    this.queryRunner = options?.queryRunner ?? defaultQuery;
  }

  async run(request: AgentProviderRequest): Promise<AgentProviderResponse> {
    const abortController = new AbortController();
    if (request.signal) {
      if (request.signal.aborted) {
        abortController.abort();
      } else {
        request.signal.addEventListener('abort', () => abortController.abort(), { once: true });
      }
    }

    const disallowedTools = ['AskUserQuestion', ...(request.tools.disallowed ?? [])];
    const isEditMode = request.tools.mode === AgentToolsMode.Edit;
    const permissionMode = isEditMode ? 'bypassPermissions' : 'dontAsk';
    const allowDangerouslySkipPermissions = isEditMode ? true : undefined;

    const queryStream = this.queryRunner({
      prompt: request.prompt,
      options: {
        model: request.model,
        systemPrompt: request.instructions,
        cwd: request.workdir,
        allowedTools: request.tools.allowed,
        disallowedTools,
        permissionMode,
        allowDangerouslySkipPermissions,
        mcpServers: request.mcpServers as unknown as Record<string, never>,
        outputFormat:
          request.outputSchema && Object.keys(request.outputSchema).length > 0
            ? {
                type: 'json_schema',
                schema: request.outputSchema as Record<string, unknown>
              }
            : undefined,
        abortController,
        env: {
          ...process.env,
          ...request.env
        }
      }
    });

    let finalResult: SdkResultMessage | null = null;
    for await (const message of queryStream) {
      const candidate = message as unknown as SdkResultMessage;
      if (candidate && typeof candidate === 'object' && candidate.type === 'result') {
        finalResult = candidate;
        break;
      }
    }

    if (!finalResult || finalResult.is_error || finalResult.subtype !== 'success') {
      // A turn can finish (`success`) and still be an error (API or auth failure); its reason is the result text.
      const reason = finalResult?.errors?.join('; ') || finalResult?.result || 'no result';
      throw new Error(`Claude agent execution failed (${finalResult?.subtype ?? 'unknown'}): ${reason}`);
    }

    return {
      output: finalResult.structured_output,
      usage: finalResult.usage
        ? {
            inputTokens: finalResult.usage.input_tokens ?? 0,
            outputTokens: finalResult.usage.output_tokens ?? 0
          }
        : undefined
    };
  }
}
