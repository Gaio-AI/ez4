import type { ContextSource, DeployOptions, EventContext, ServiceMetadata } from '@ez4/project/library';
import type { AgentService, AgentWorkflowService } from '@ez4/agent/library';
import type { QueueState } from '@ez4/aws-queue';
import type { EcsClusterState, EcsTaskDefState } from '@ez4/aws-ecs';
import { isAgentService, isAgentWorkflowService, InvalidReplyToError } from '@ez4/agent/library';
import { QueueServiceType } from '@ez4/aws-queue';
import { getDefinitionName } from '@ez4/project/library';
import { createBucketStateId } from '@ez4/aws-bucket';
import { createEcsClusterStateId, createEcsTaskDefStateId } from '@ez4/aws-ecs';
import { hashData } from '@ez4/utils';
import { getAgentBucketName, getAgentClusterName, getWorkflowStartQueueName } from '../utils/names';
export interface LinkedAgentEvent {
  service: ServiceMetadata;
  target?: ServiceMetadata;
  options: DeployOptions;
  context: EventContext;
}

export const prepareLinkedService = (event: LinkedAgentEvent): ContextSource | null => {
  const { service, options, context } = event;
  if (isAgentWorkflowService(service)) {
    const workflow = service as AgentWorkflowService;
    const startQueueName = getWorkflowStartQueueName(workflow.name, options);
    const startQueueId = hashData(QueueServiceType, startQueueName);
    const startQueueUrl = getDefinitionName<QueueState>(startQueueId, 'queueUrl');

    const clientParameters = {
      workflow: workflow.name,
      startQueueUrl: `@{EZ4_RAW_EXPRESSION}:${startQueueUrl}`,
      bucket: getAgentBucketName(options),
      inputSchema: workflow.inputSchema
    };

    const constructorParams = JSON.stringify(clientParameters).replace(/"@\{EZ4_RAW_EXPRESSION\}:(.*?)"/g, '$1');

    return {
      module: 'WorkflowClient',
      from: '@ez4/aws-agent/client',
      constructor: `@{EZ4_MODULE_IMPORT}.make(${constructorParams})`,
      dependencyIds: [startQueueId],
      connectionIds: [startQueueId]
    };
  }

  if (!isAgentService(service)) {
    return null;
  }

  const agent = service as AgentService;
  const replyToOption = agent.options?.replyTo;

  if (!replyToOption) {
    return getAgentClientSource(agent, options);
  }

  if (typeof replyToOption !== 'string') {
    throw new InvalidReplyToError(replyToOption, agent.file);
  }

  let queueState: unknown;
  try {
    queueState = context.getServiceState(replyToOption, options);
  } catch {
    throw new InvalidReplyToError(replyToOption, agent.file);
  }

  if (!queueState || (queueState as QueueState).type !== QueueServiceType || !(queueState as QueueState).parameters?.fifoMode) {
    throw new InvalidReplyToError(replyToOption, agent.file);
  }

  return getAgentClientSource(agent, options, (queueState as QueueState).entryId);
};

/**
 * The agent client a function bundles, resolved from deployed entries; results go to the given FIFO queue, if any.
 */
export const getAgentClientSource = (agent: AgentService, options: DeployOptions, replyToQueueId?: string): ContextSource => {
  const clusterStateId = createEcsClusterStateId(getAgentClusterName(options));
  const taskDefStateId = createEcsTaskDefStateId(agent.name);

  const dependencyIds = [taskDefStateId, clusterStateId, createBucketStateId(getAgentBucketName(options))];

  if (replyToQueueId) {
    dependencyIds.unshift(replyToQueueId);
  }

  const clusterArn = getDefinitionName<EcsClusterState>(clusterStateId, 'clusterArn');
  const taskDefinitionArn = getDefinitionName<EcsTaskDefState>(taskDefStateId, 'taskDefinitionArn');
  const subnetIds = getDefinitionName<EcsTaskDefState>(taskDefStateId, 'subnetIds');
  const securityGroupIds = getDefinitionName<EcsTaskDefState>(taskDefStateId, 'securityGroupIds');

  const clientParameters = {
    agentName: agent.name,
    cluster: `@{EZ4_RAW_EXPRESSION}:${clusterArn}`,
    taskDefinition: `@{EZ4_RAW_EXPRESSION}:${taskDefinitionArn}`,
    bucket: getAgentBucketName(options),
    subnets: `@{EZ4_RAW_EXPRESSION}:${subnetIds}.split(',')`,
    securityGroups: `@{EZ4_RAW_EXPRESSION}:${securityGroupIds}.split(',')`,
    ...(replyToQueueId && { replyTo: `@{EZ4_RAW_EXPRESSION}:${getDefinitionName<QueueState>(replyToQueueId, 'queueUrl')}` }),
    timeout: agent.resources?.timeout ?? 3600,
    inputSchema: agent.inputSchema ?? { type: 'object' }
  };

  const constructorParams = JSON.stringify(clientParameters).replace(/"@\{EZ4_RAW_EXPRESSION\}:(.*?)"/g, '$1');

  return {
    module: 'Client',
    from: '@ez4/aws-agent/client',
    constructor: `@{EZ4_MODULE_IMPORT}.make(${constructorParams})`,
    dependencyIds,
    connectionIds: dependencyIds
  };
};
