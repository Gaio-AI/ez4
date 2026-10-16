import type { Agent } from '@ez4/agent';
import type { AnyObject } from '@ez4/utils';

export interface AgentProviderRequest {
  model: string;
  instructions: string;
  prompt: string;
  workdir: string;
  tools: Agent.Tools;
  mcpServers: Record<string, Agent.McpServer>;
  outputSchema: AnyObject;
  env: Record<string, string>;
  signal: AbortSignal;
}

export interface AgentProviderResponse {
  output: unknown;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AgentProvider {
  run(request: AgentProviderRequest): Promise<AgentProviderResponse>;
}

export type AgentProviderFactory = () => Promise<AgentProvider>;
