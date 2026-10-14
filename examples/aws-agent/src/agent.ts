import { Agent } from '@ez4/agent';

export interface EchoInput {
  message: string;
}

export interface EchoOutput {
  echo: string;
}

export declare class EchoAgent extends Agent.Service<EchoInput, EchoOutput> {
  provider: 'claude';
  model: 'claude-sonnet-4-5';
  instructions: 'You are an echo agent. Return the input message in the echo field.';
  input: EchoInput;
  output: EchoOutput;
  tools: {
    mode: 'readonly';
    allowed: ['Read'];
  };
  egress: ['api.github.com'];
  resources: {
    cpu: 1024;
    memory: 2048;
    timeout: 300;
  };
}
