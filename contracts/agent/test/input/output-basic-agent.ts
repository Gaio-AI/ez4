import type { Agent } from '@ez4/agent';

export interface BasicInput {
  prompt: string;
}

export interface BasicOutput {
  response: string;
}

export declare class BasicAgent extends Agent.Service<BasicInput, BasicOutput> {
  provider: 'claude';
  model: 'claude-3-7-sonnet-latest';
  instructions: 'You are a helpful assistant.';
  input: BasicInput;
  output: BasicOutput;
}
