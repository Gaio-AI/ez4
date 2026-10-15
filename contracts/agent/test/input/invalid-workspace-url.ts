import type { Agent } from '@ez4/agent';

export declare class InvalidWorkspaceAgent extends Agent.Service<{ task: string }, { done: boolean }> {
  provider: 'claude';
  model: 'opus';
  instructions: 'Work on the repo.';
  input: { task: string };
  output: { done: boolean };
  workspace: { repos: [{ url: 'git@github.com:acme/api.git' }] };
}
