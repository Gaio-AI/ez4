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
  workspace: {
    repos: [{ url: 'https://github.com/Gaio-AI/ez4.git' }];
  };
  egress: ['api.github.com'];
  resources: {
    cpu: 1024;
    memory: 2048;
    timeout: 300;
  };
}

export declare class EchoFlow extends Agent.Workflow<{ text: string }, { echoes: number }, { echo: EchoAgent }> {
  input: { text: string };
  agents: { echo: EchoAgent };
  maxSteps: 2;
  handler: typeof echoStep;
}

export function echoStep(request: Agent.WorkflowRequest<EchoFlow>): Agent.WorkflowStep<{ echoes: number }, { echo: EchoAgent }> {
  if (request.event.type === 'start') {
    return { state: { echoes: 0 }, next: { invoke: 'echo', input: { message: request.event.input.text } } };
  }

  return { state: { echoes: 1 }, next: { complete: request.event.result.status } };
}
