import type { Agent } from '@ez4/agent';

export declare class WorkspaceAgent extends Agent.Service<{ task: string }, { done: boolean }> {
  provider: 'claude';
  model: 'opus';
  instructions: 'Work on the repos.';
  input: { task: string };
  output: { done: boolean };
  tools: { mode: 'edit' };
  workspace: {
    repos: [{ url: 'https://github.com/acme/api.git' }, { url: 'https://github.com/acme/web.git'; name: 'frontend'; branch: 'develop' }];
    auth: { githubApp: 'acme/github-app' };
  };
}
