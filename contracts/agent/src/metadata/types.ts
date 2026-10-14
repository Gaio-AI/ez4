import type { FunctionSignature } from '@ez4/common/library';
import type { ServiceMetadata } from '@ez4/project/library';
import type { ObjectSchema } from '@ez4/schema';
import type { Agent } from '../services/contract';

import { createServiceMetadata } from '@ez4/project/library';

export const ServiceType = '@ez4/agent';

export type AgentService = Omit<ServiceMetadata, 'variables' | 'services'> &
  Required<Pick<ServiceMetadata, 'variables' | 'services'>> & {
    type: typeof ServiceType;
    name: string;
    file?: string;
    description?: string;
    provider?: Agent.ProviderName;
    model?: string;
    instructions?: string;
    tools?: Agent.Tools;
    mcpServers?: Record<string, Agent.McpServer>;
    prepare?: FunctionSignature;
    finish?: FunctionSignature;
    image?: Agent.Image;
    resources?: Agent.Resources;
    permissions?: Agent.Permissions;
    egress?: string[];
    secrets?: Record<string, string>;
    inputSchema?: ObjectSchema;
    outputSchema?: ObjectSchema;
    tags?: Record<string, string>;
  };

export const isAgentService = (service: ServiceMetadata): service is AgentService => {
  return service.type === ServiceType;
};

export const createAgentService = (name: string, file?: string, description?: string) => {
  return {
    ...createServiceMetadata<AgentService>(ServiceType, name),
    ...(description && { description }),
    ...(file && { file }),
    variables: {},
    services: {}
  } as AgentService;
};
