import type { AgentProvider as RuntimeProvider } from '../types';

import { AgentProvider } from '@ez4/agent';
import { ClaudeAgentProvider } from './claude';

export * from './claude';

export const AgentProviders: Record<AgentProvider, () => Promise<RuntimeProvider>> = {
  [AgentProvider.Claude]: () => Promise.resolve(new ClaudeAgentProvider())
};
