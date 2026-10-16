import type { Agent, AgentPermission, AgentProvider } from '@ez4/agent';

export declare class InvalidGrantResourceAgent extends Agent.Service<{ prompt: string }, { result: string }> {
  provider: AgentProvider.Claude;
  model: 'claude-3-7-sonnet-latest';
  instructions: 'You are an agent.';
  input: { prompt: string };
  output: { result: string };
  permissions: {
    grants: [{ permission: AgentPermission.CodeArtifactRead; resources: ['acme'] }];
  };
}
