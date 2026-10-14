import type { Agent } from '@ez4/agent';
import type { ObjectSchema } from '@ez4/schema';
import type { AgentStorage } from './storage';
import type { AgentProvider } from './types';
import { runAgentRuntime } from './main';
import { createS3Storage } from './storage';
import { AgentProviders } from './providers/index';

export type AgentEntryDefinition = {
  name: string;
  provider: Agent.ProviderName;
  model: string;
  instructions: string;
  tools: Agent.Tools;
  mcpServers: Record<string, Agent.McpServer>;
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
  timeout: number;
  hooks: { prepare: number; finish: number };
};

export class MissingAgentEnvironmentError extends Error {
  constructor(public variable: string) {
    super(`Agent container is missing the environment variable ${variable}.`);
  }
}

const required = (env: Record<string, string | undefined>, name: string) => {
  const value = env[name];
  if (!value) throw new MissingAgentEnvironmentError(name);
  return value;
};

export const readAgentEnvironment = (env: Record<string, string | undefined>) => ({
  agentName: required(env, 'EZ4_AGENT_NAME'),
  invocationId: required(env, 'EZ4_AGENT_ID'),
  bucketName: required(env, 'EZ4_AGENT_BUCKET'),
  timeoutSeconds: Number(required(env, 'EZ4_AGENT_TIMEOUT'))
});

export const startAgent = async (
  definition: AgentEntryDefinition,
  handlers: Function[],
  context: object,
  env: Record<string, string | undefined> = process.env,
  ports: { storage?: AgentStorage; provider?: AgentProvider } = {}
): Promise<number> => {
  const { agentName, invocationId, bucketName, timeoutSeconds } = readAgentEnvironment(env);
  const hook = (index: number) => (index >= 0 ? handlers[index] : undefined);
  return runAgentRuntime({
    agentName,
    invocationId,
    timeoutSeconds,
    storage: ports.storage ?? createS3Storage(bucketName),
    provider: ports.provider ?? (await AgentProviders[definition.provider]()),
    model: definition.model,
    instructions: definition.instructions,
    tools: definition.tools,
    mcpServers: definition.mcpServers,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    prepare: hook(definition.hooks.prepare) as never,
    finish: hook(definition.hooks.finish) as never,
    context
  });
};
