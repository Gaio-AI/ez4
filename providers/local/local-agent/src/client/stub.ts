import type { Agent } from '@ez4/agent';
import { AgentNotEmulatedError } from '../errors/stub';

export type AgentStubClient = Agent.Client<Agent.Service<Agent.Input, Agent.Output>>;
export type WorkflowStubClient = Agent.WorkflowClient<
  Agent.Workflow<Agent.Input, unknown, Record<string, Agent.Service<Agent.Input, Agent.Output>>>
>;

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

export const createWorkflowStubClient = (workflowName: string): WorkflowStubClient => {
  return {
    start(_input: unknown, _options?: unknown): Promise<{ runId: string }> {
      return Promise.reject(new AgentNotEmulatedError(workflowName));
    },
    status(_runId: string): Promise<never> {
      return Promise.reject(new AgentNotEmulatedError(workflowName));
    }
  };
};

export const createWorkflowEmulatorClient = (workflowName: string): WorkflowStubClient => {
  return createWorkflowStubClient(workflowName);
};
