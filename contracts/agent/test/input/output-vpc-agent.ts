import type { Agent, AgentProvider } from '@ez4/agent';

export interface VpcInput {
  prompt: string;
}

export interface VpcOutput {
  response: string;
}

export declare class VpcAgent extends Agent.Service<VpcInput, VpcOutput> {
  provider: AgentProvider.Claude;
  model: 'claude-3-7-sonnet-latest';
  instructions: 'You read a service that only the VPC reaches.';
  input: VpcInput;
  output: VpcOutput;
  vpc: true;
}
