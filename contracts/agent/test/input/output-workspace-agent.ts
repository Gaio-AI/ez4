import type { Agent, AgentProvider, AgentToolsMode } from '@ez4/agent';

export declare class WorkspaceAgent extends Agent.Service<{ task: string }, { done: boolean }> {
  provider: AgentProvider.Claude;
  model: 'opus';
  instructions: 'Work on the repos.';
  input: { task: string };
  output: { done: boolean };
  tools: { mode: AgentToolsMode.Edit };
  workspace: {
    repos: [{ url: 'https://github.com/acme/api.git' }, { url: 'https://github.com/acme/web.git'; name: 'frontend'; branch: 'develop' }];
    auth: { githubApp: { appId: '123'; installationId: '456'; privateKey: 'app-private-key' } };
  };
}
