import type { DeployOptions } from '@ez4/project/library';
import type { AgentService } from '@ez4/agent/library';
import { createHash } from 'node:crypto';
import { toKebabCase } from '@ez4/utils';

export const getAgentsBaseName = (options: DeployOptions) => {
  const parts = [options.prefix, options.projectName, options.branchName, 'agents'];
  return parts.filter((part): part is string => !!part).map((part) => toKebabCase(part)).join('-');
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
