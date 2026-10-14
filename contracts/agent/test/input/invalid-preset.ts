import type { Agent } from '@ez4/agent';

export declare class InvalidPresetAgent extends Agent.Service<{ prompt: string }, { result: string }> {
  provider: 'claude';
  model: 'claude-3-7-sonnet-latest';
  instructions: 'You are an agent.';
  input: { prompt: string };
  output: { result: string };
  // @ts-expect-error Invalid preset for test
  permissions: {
    presets: ['unknown-preset'];
  };
}
