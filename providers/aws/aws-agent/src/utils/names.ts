import type { DeployOptions } from '@ez4/project/library';
import type { AgentService } from '@ez4/agent/library';
import { createHash } from 'node:crypto';
import { toKebabCase } from '@ez4/utils';

export const getAgentsBaseName = (options: DeployOptions) => {
  const parts = [options.prefix, options.projectName, options.branchName, 'agents'];
  return parts
    .filter((part): part is string => !!part)
    .map((part) => toKebabCase(part))
    .join('-');
};

export const getAgentClusterName = (options: DeployOptions) => getAgentsBaseName(options);

export const getAgentBucketName = (options: DeployOptions) => {
  const base = getAgentsBaseName(options);
  return `${base}-${createHash('sha256').update(base).digest('hex').slice(0, 6)}`;
};

export const getAgentKey = (agent: Pick<AgentService, 'name'>) => agent.name;

export const getAgentLogGroupName = (agent: Pick<AgentService, 'name'>, options: DeployOptions) =>
  `/ez4/agents/${getAgentsBaseName(options)}/${toKebabCase(agent.name)}`;

export const getAgentRepositoryName = (agent: Pick<AgentService, 'name'>, options: DeployOptions) =>
  `${getAgentsBaseName(options)}/${toKebabCase(agent.name)}`;

export const getAgentProxySecretName = (agent: Pick<AgentService, 'name'>, options: DeployOptions) =>
  `${getAgentsBaseName(options)}-${toKebabCase(agent.name)}-proxy`;
export const getAgentTaskRoleName = (agent: Pick<AgentService, 'name'>, options: DeployOptions) =>
  `${getAgentsBaseName(options)}-${toKebabCase(agent.name)}-task-role`;

export const getWorkspaceFileSystemName = (options: DeployOptions) => `${getAgentsBaseName(options)}-workspace`;

export const getAgentsNamespaceName = (options: DeployOptions) => `${getAgentsBaseName(options)}.local`;

export const getAgentProxyUrl = (options: DeployOptions) => `http://proxy.${getAgentsNamespaceName(options)}:3128`;

export const getProviderSecretName = (provider: string, options: DeployOptions) =>
  `${toKebabCase(options.prefix ?? 'ez4')}/agents/${provider}`;

/** IAM resource for a secret reference: `name`, `name:jsonKey`, or a secret ARN optionally followed by `:jsonKey:stage:version`. */
export const getSecretResourceArn = (secretRef: string, region: string, accountId: string) => {
  if (secretRef.startsWith('arn:')) return secretRef.split(':').slice(0, 7).join(':');
  const [secretName] = secretRef.split(':');
  return `arn:aws:secretsmanager:${region}:${accountId}:secret:${secretName}-*`;
};

export const getWorkflowStartQueueName = (workflow: string, options: DeployOptions) =>
  `${getAgentsBaseName(options)}-${toKebabCase(workflow)}-start`;

export const getWorkflowResultsQueueName = (workflow: string, options: DeployOptions) =>
  `${getAgentsBaseName(options)}-${toKebabCase(workflow)}-results.fifo`;

export const getWorkflowFunctionName = (workflow: string, options: DeployOptions) =>
  `${getAgentsBaseName(options)}-${toKebabCase(workflow)}`;

export const getWorkflowStateKey = (workflow: string, runId: string) => `workflows/${workflow}/${runId}.json`;

// Prefixed so a workflow agent never collides with a linked service of the same name in the bundled context.
export const getWorkflowAgentContextName = (alias: string) => `agent:${alias}`;
