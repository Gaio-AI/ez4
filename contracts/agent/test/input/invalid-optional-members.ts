import type { Agent, AgentProvider } from '@ez4/agent';

interface Input {
  task: string;
}
interface Output {
  result: string;
}

export declare class InvalidTools extends Agent.Service<Input, Output> {
  provider: AgentProvider.Claude;
  model: 'test';
  instructions: 'test';
  input: Input;
  output: Output;
  // @ts-expect-error malformed metadata should be reported by the parser
  tools: { mode: 'unknown' };
}

export declare class InvalidMcpServers extends Agent.Service<Input, Output> {
  provider: AgentProvider.Claude;
  model: 'test';
  instructions: 'test';
  input: Input;
  output: Output;
  // @ts-expect-error malformed metadata should be reported by the parser
  mcpServers: { github: { command: 123 } };
}

export declare class InvalidImage extends Agent.Service<Input, Output> {
  provider: AgentProvider.Claude;
  model: 'test';
  instructions: 'test';
  input: Input;
  output: Output;
  // @ts-expect-error malformed metadata should be reported by the parser
  image: { aptPackages: [123] };
}

export declare class InvalidEgress extends Agent.Service<Input, Output> {
  provider: AgentProvider.Claude;
  model: 'test';
  instructions: 'test';
  input: Input;
  output: Output;
  // @ts-expect-error malformed metadata should be reported by the parser
  egress: [123];
}

export declare class InvalidVpc extends Agent.Service<Input, Output> {
  provider: AgentProvider.Claude;
  model: 'test';
  instructions: 'test';
  input: Input;
  output: Output;
  // @ts-expect-error malformed metadata should be reported by the parser
  vpc: 'yes';
}

export declare class InvalidSecrets extends Agent.Service<Input, Output> {
  provider: AgentProvider.Claude;
  model: 'test';
  instructions: 'test';
  input: Input;
  output: Output;
  // @ts-expect-error malformed metadata should be reported by the parser
  secrets: { API_KEY: 123 };
}

export declare class InvalidStatements extends Agent.Service<Input, Output> {
  provider: AgentProvider.Claude;
  model: 'test';
  instructions: 'test';
  input: Input;
  output: Output;
  // @ts-expect-error malformed metadata should be reported by the parser
  permissions: { statements: [{ actions: ['s3:GetObject']; resources: [123] }] };
}
