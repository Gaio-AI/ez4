import type { Agent } from '@ez4/agent';

export declare class InvalidResourcesAgent extends Agent.Service<{ prompt: string }, { result: string }> {
  provider: 'claude';
  model: 'claude-3-7-sonnet-latest';
  instructions: 'You are an agent.';
  input: { prompt: string };
  output: { result: string };
  resources: {
    cpu: 256;
    memory: 8192; // 256 CPU only supports 512, 1024, 2048 MB
  };
}
