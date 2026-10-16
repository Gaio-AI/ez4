import type { FunctionSignature } from '@ez4/common/library';
import type { ServiceMetadata } from '@ez4/project/library';
import type { ObjectSchema } from '@ez4/schema';
import type { Agent } from '../services/contract';
import type { AgentProvider } from '../services/provider';

import { createServiceMetadata } from '@ez4/project/library';

export const ServiceType = '@ez4/agent';
export const WorkflowServiceType = '@ez4/agent-workflow';

export type AgentWorkflowService = Omit<ServiceMetadata, 'variables' | 'services'> &
  Required<Pick<ServiceMetadata, 'variables' | 'services'>> & {
    name: string;
    file?: string;
    description?: string;
    tags?: Record<string, string>;
    type: typeof WorkflowServiceType;
    inputSchema: ObjectSchema;
    agents: Record<string, string>;
    handler: FunctionSignature;
    maxSteps: number;
  };

export const isAgentWorkflowService = (service: ServiceMetadata): service is AgentWorkflowService => {
  return service.type === WorkflowServiceType;
};

export const createAgentWorkflowService = (name: string, file?: string, description?: string) =>
  ({
    ...createServiceMetadata<AgentWorkflowService>(WorkflowServiceType, name),
    ...(description && { description }),
    ...(file && { file }),
    variables: {},
    services: {},
    agents: {},
    maxSteps: 10
  }) as AgentWorkflowService;

export type AgentService = Omit<ServiceMetadata, 'variables' | 'services'> &
  Required<Pick<ServiceMetadata, 'variables' | 'services'>> & {
    type: typeof ServiceType;
    name: string;
    file?: string;
    description?: string;
    provider?: AgentProvider;
    model?: string;
    instructions?: string;
    tools?: Agent.Tools;
    mcpServers?: Record<string, Agent.McpServer>;
    workspace?: { repos: Required<Agent.WorkspaceRepo>[]; auth?: Agent.WorkspaceAuth };
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
