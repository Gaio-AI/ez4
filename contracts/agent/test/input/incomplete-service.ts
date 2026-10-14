import type { Agent } from '@ez4/agent';

// @ts-expect-error Missing provider, model, instructions
export declare class IncompleteAgent extends Agent.Service<{ prompt: string }, { result: string }> {
  input: { prompt: string };
  output: { result: string };
}
