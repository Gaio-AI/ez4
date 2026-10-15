import type { Agent } from '@ez4/agent';

export declare class DuplicateWorkspaceAgent extends Agent.Service<{ task: string }, { done: boolean }> {
  provider: 'claude';
  model: 'opus';
  instructions: 'Work on the repos.';
  input: { task: string };
  output: { done: boolean };
  workspace: {
    repos: [{ url: 'https://github.com/acme/api.git' }, { url: 'https://github.com/other/api.git'; name: 'api' }];
  };
}
