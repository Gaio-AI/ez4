import type { Agent } from '@ez4/agent';
import type { AgentProvider } from '../types';
import { ClaudeAgentProvider } from './claude';

export * from './claude';

export const AgentProviders: Record<Agent.ProviderName, () => Promise<AgentProvider>> = {
  claude: () => Promise.resolve(new ClaudeAgentProvider())
};
