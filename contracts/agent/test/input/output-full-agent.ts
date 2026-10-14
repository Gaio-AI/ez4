import type { Agent } from '@ez4/agent';

export interface FullInput {
  task: string;
}

export interface FullOutput {
  result: string;
}

export declare class FullAgent extends Agent.Service<FullInput, FullOutput> {
  provider: 'claude';
  model: 'claude-3-7-sonnet-latest';
  instructions: 'You are an autonomous engineering agent.';
  input: FullInput;
  output: FullOutput;
  tools: {
    mode: 'edit';
    allowed: ['Read', 'Grep', 'Glob'];
    disallowed: ['AskUserQuestion'];
  };
  mcpServers: {
    github: {
      command: 'npx';
      args: ['-y', '@modelcontextprotocol/server-github'];
    };
  };
  prepare: typeof prepareAgent;
  finish: typeof finishAgent;
  image: {
    base: 'public.ecr.aws/docker/library/node:24-bookworm-slim';
    aptPackages: ['curl', 'git'];
    npmPackages: ['typescript'];
  };
  resources: {
    cpu: 1024;
    memory: 2048;
    storage: 50;
    timeout: 1800;
  };
  permissions: {
    presets: ['logs-read'];
    statements: [
      {
        effect: 'allow';
        actions: ['s3:GetObject'];
        resources: ['arn:aws:s3:::my-bucket/*'];
      }
    ];
  };
  egress: ['api.github.com', '.anthropic.com'];
  secrets: {
    GITHUB_TOKEN: 'github/token';
  };
}

export function prepareAgent(req: Agent.PrepareRequest<FullInput>) {
  return { prompt: req.input.task };
}

export function finishAgent(req: Agent.FinishRequest<FullInput, FullOutput>) {
  return req.output;
}
