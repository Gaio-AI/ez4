import type { AgentService } from '@ez4/agent/library';
import type { FunctionSignature } from '@ez4/common/library';
import type { DeployOptions } from '@ez4/project/library';
import type { AgentEntryDefinition } from './entry';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getFunctionBundle } from '@ez4/aws-common';
import { getServiceName } from '@ez4/project/library';
import { toKebabCase } from '@ez4/utils';

import { AGENT_IMAGE_PACKAGES } from '../image/dockerfile';

// __MODULE_PATH is defined by the package bundler.
declare const __MODULE_PATH: string;

export const getAgentTemplateFile = () => join(__MODULE_PATH, '../lib/agent.ts');

export const getAgentEntryDefinition = (agent: AgentService): AgentEntryDefinition => {
  const hooks = [agent.prepare, agent.finish].filter((hook) => !!hook);
  return {
    name: agent.name,
    provider: agent.provider!,
    model: agent.model!,
    instructions: agent.instructions!,
    tools: agent.tools ?? { mode: 'readonly' },
    mcpServers: agent.mcpServers ?? {},
    inputSchema: agent.inputSchema!,
    outputSchema: agent.outputSchema!,
    timeout: agent.resources?.timeout ?? 3600,
    hooks: { prepare: agent.prepare ? 0 : -1, finish: agent.finish ? hooks.indexOf(agent.finish) : -1 }
  };
};

export const buildAgentBundle = async (agent: AgentService, options: DeployOptions) => {
  const handlers = [agent.prepare, agent.finish]
    .filter((hook): hook is FunctionSignature => !!hook)
    .map((hook) => ({ functionName: hook.name, sourceFile: hook.file, module: hook.module }));
  const file = await getFunctionBundle('@ez4/aws-agent', {
    groupName: `${toKebabCase(agent.name)}-agent`,
    filePrefix: 'agent',
    templateFile: getAgentTemplateFile(),
    resourceName: getServiceName(agent, options),
    handlers,
    context: agent.context,
    define: { __EZ4_AGENT: JSON.stringify(getAgentEntryDefinition(agent)) },
    target: 'node24',
    external: AGENT_IMAGE_PACKAGES
  });
  const hash = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  return { file, hash };
};
