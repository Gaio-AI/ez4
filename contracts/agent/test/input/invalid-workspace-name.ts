import type { Agent, AgentProvider } from '@ez4/agent';

export declare class UnsafeWorkspaceAgent extends Agent.Service<{ task: string }, { done: boolean }> {
  provider: AgentProvider.Claude;
  model: 'opus';
  instructions: 'Work on repos';
  input: { task: string };
  output: { done: boolean };
  workspace: {
    repos: [{ url: 'https://github.com/acme/api.git'; name: '..' }, { url: 'https://github.com/acme/web.git'; name: 'nested/web' }];
  };
}
