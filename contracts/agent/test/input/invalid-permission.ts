import type { Agent, AgentProvider } from '@ez4/agent';

export declare class InvalidPermissionAgent extends Agent.Service<{ prompt: string }, { result: string }> {
  provider: AgentProvider.Claude;
  model: 'claude-3-7-sonnet-latest';
  instructions: 'You are an agent.';
  input: { prompt: string };
  output: { result: string };
  // @ts-expect-error Invalid permission for test
  permissions: {
    grants: [{ permission: 'logs-write'; resources: ['api-*'] }];
  };
}
