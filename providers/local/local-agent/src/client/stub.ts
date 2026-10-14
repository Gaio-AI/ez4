import type { Agent } from '@ez4/agent';
import { AgentNotEmulatedError } from '../errors/stub';

export type AgentStubClient = Agent.Client<Agent.Service<Agent.Input, Agent.Output>>;

export const createAgentStubClient = (agentName: string): AgentStubClient => {
  return {
    invoke(_input: unknown, _options?: unknown): Promise<{ id: string }> {
      return Promise.reject(new AgentNotEmulatedError(agentName));
    },
    result(_invocationId: string): Promise<never> {
      return Promise.reject(new AgentNotEmulatedError(agentName));
    }
  };
};
