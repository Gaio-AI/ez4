import type { Agent, AgentProvider } from '@ez4/agent';

export declare class MissingKeyAgent extends Agent.Service<{ task: string }, { done: boolean }> {
  provider: AgentProvider.Claude;
  model: 'opus';
  instructions: 'Work on the repo.';
  input: { task: string };
  output: { done: boolean };
  // @ts-expect-error privateKey is missing
  workspace: {
    repos: [{ url: 'https://github.com/acme/api.git' }];
    auth: { githubApp: { appId: '123'; installationId: '456' } };
  };
}
