import type { Agent, AgentPermission } from '@ez4/agent';

export declare class InvalidGrantResourceAgent extends Agent.Service<{ prompt: string }, { result: string }> {
  provider: 'claude';
  model: 'claude-3-7-sonnet-latest';
  instructions: 'You are an agent.';
  input: { prompt: string };
  output: { result: string };
  permissions: {
    grants: [{ permission: AgentPermission.CodeArtifactRead; resources: ['acme'] }];
  };
}
