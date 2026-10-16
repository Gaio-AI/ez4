import type { Environment, Service } from '@ez4/common';
import { Agent, AgentPermission, AgentProvider, AgentToolsMode, WorkflowEventType } from '@ez4/agent';

export interface EchoInput {
  message: string;
}

export interface EchoOutput {
  echo: string;
}

export declare class EchoAgent extends Agent.Service<EchoInput, EchoOutput> {
  provider: AgentProvider.Claude;
  model: 'claude-sonnet-4-5';
  instructions: 'You are an echo agent. Return the input message in the echo field.';
  input: EchoInput;
  output: EchoOutput;
  tools: {
    mode: AgentToolsMode.Readonly;
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
  prepare: typeof prepareEcho;
  variables: { ECHO_AGENT_TAG: 'agent-variable' };
  services: { variables: Environment.ServiceVariables };
}

// Agent variables reach the hooks through the context, like any other ez4 handler.
export async function prepareEcho(request: Agent.PrepareRequest<EchoInput>, context: Service.Context<EchoAgent>): Promise<Agent.PrepareResult> {
  await request.artifacts.put('agent-tag.txt', context.variables.ECHO_AGENT_TAG);
  return { prompt: JSON.stringify(request.input) };
}

export declare class EchoFlow extends Agent.Workflow<{ text: string }, { echoes: number }, { echo: EchoAgent }> {
  input: { text: string };
  state: { echoes: number };
  agents: { echo: EchoAgent };
  maxSteps: 2;
  handler: typeof echoStep;
  variables: { ECHO_PREFIX: 'workflow-variable' };
  services: { variables: Environment.ServiceVariables };
}

export function echoStep(
  request: Agent.WorkflowRequest<EchoFlow>,
  context: Service.Context<EchoFlow>
): Agent.WorkflowStep<{ echoes: number }, { echo: EchoAgent }> {
  if (request.event.type === WorkflowEventType.Start) {
    const message = `${context.variables.ECHO_PREFIX}: ${request.event.input.text}`;
    return { state: { echoes: 0 }, next: { invoke: 'echo', input: { message } } };
  }

  return { state: { echoes: 1 }, next: { complete: request.event.result.status } };
}

export interface LogsInput {
  logGroups: string[];
}

export interface LogsOutput {
  messages: string[];
  denied: string[];
}

export declare class LogsAgent extends Agent.Service<LogsInput, LogsOutput> {
  provider: AgentProvider.Claude;
  model: 'claude-sonnet-4-5';
  instructions: 'For each log group in the input, run `aws logs tail <group> --since 1d --format short`. Return the text of every event you read in messages, without its timestamp, and every log group whose command failed with an access error in denied.';
  input: LogsInput;
  output: LogsOutput;
  tools: {
    mode: AgentToolsMode.Readonly;
    allowed: ['Bash(aws logs tail:*)'];
  };
  image: {
    aptPackages: ['awscli'];
  };
  permissions: {
    // Log groups named `<prefix>-aws-agent-app-*`: the deploy prefix is applied by ez4.
    grants: [{ permission: AgentPermission.LogsRead; resources: ['aws-agent-app-*'] }];
  };
  resources: {
    cpu: 1024;
    memory: 2048;
    timeout: 300;
  };
}

export declare class LogsFlow extends Agent.Workflow<LogsInput, { reads: number }, { logs: LogsAgent }> {
  input: LogsInput;
  state: { reads: number };
  agents: { logs: LogsAgent };
  maxSteps: 2;
  handler: typeof logsStep;
}

export function logsStep(request: Agent.WorkflowRequest<LogsFlow>): Agent.WorkflowStep<{ reads: number }, { logs: LogsAgent }> {
  if (request.event.type === WorkflowEventType.Start) {
    return { state: { reads: 0 }, next: { invoke: 'logs', input: request.event.input } };
  }

  return { state: { reads: 1 }, next: { complete: request.event.result.status } };
}
