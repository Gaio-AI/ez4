import type { Agent } from '@ez4/agent';
import type { ObjectSchema } from '@ez4/schema';
import type { AgentStorage } from './storage';
import type { AgentProvider } from './types';
import { runAgentRuntime } from './main';
import { createS3Storage } from './storage';
import { AgentProviders } from './providers/index';
import { WORKSPACE_MOUNT_PATH, type WorkspaceRuntime } from '../workspace/runtime';
import { mintInstallationToken } from '../workspace/github';
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

/** Points HTTP clients (the provider CLI and its tools) at the egress proxy, authenticated as this agent. */
export const applyProxyEnvironment = (env: Record<string, string | undefined>) => {
  const proxyUrl = env.EZ4_AGENT_PROXY_URL;
  const password = env.EZ4_AGENT_PROXY_PASSWORD;
  const agentName = env.EZ4_AGENT_NAME;
  if (!proxyUrl || !password || !agentName) return;
  const url = new URL(proxyUrl);
  url.username = encodeURIComponent(agentName);
  url.password = encodeURIComponent(password);
  const value = url.toString().replace(/\/$/, '');
  env.HTTPS_PROXY = env.HTTP_PROXY = env.https_proxy = env.http_proxy = value;
  env.NODE_USE_ENV_PROXY = '1';
  delete env.EZ4_AGENT_PROXY_PASSWORD;
};

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

export const resolveWorkspaceRuntime = (env: Record<string, string | undefined>): WorkspaceRuntime | undefined => {
  if (!env.EZ4_AGENT_WORKSPACE) {
    return undefined;
  }
  const workspaceMeta = JSON.parse(env.EZ4_AGENT_WORKSPACE);
  let token: (() => Promise<string | undefined>) | undefined;

  if (env.EZ4_WORKSPACE_GITHUB_APP) {
    const { GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY } = JSON.parse(env.EZ4_WORKSPACE_GITHUB_APP);
    token = () =>
      mintInstallationToken({
        appId: GITHUB_APP_ID,
        installationId: GITHUB_APP_INSTALLATION_ID,
        privateKeyPem: GITHUB_APP_PRIVATE_KEY
      });
  } else if (env.EZ4_WORKSPACE_TOKEN) {
    const secretToken = env.EZ4_WORKSPACE_TOKEN;
    token = () => Promise.resolve(secretToken);
  }

  return {
    root: WORKSPACE_MOUNT_PATH,
    workspace: workspaceMeta,
    token
  };
};

export const startAgent = async (
  definition: AgentEntryDefinition,
  handlers: Function[],
  context: object,
  env: Record<string, string | undefined> = process.env,
  ports: { storage?: AgentStorage; provider?: AgentProvider; workspace?: WorkspaceRuntime } = {}
): Promise<number> => {
  applyProxyEnvironment(env);
  const { agentName, invocationId, bucketName, timeoutSeconds } = readAgentEnvironment(env);
  const hook = (index: number) => (index >= 0 ? handlers[index] : undefined);
  const workspace = ports.workspace ?? resolveWorkspaceRuntime(env);
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
    context,
    workspace
  });
};
