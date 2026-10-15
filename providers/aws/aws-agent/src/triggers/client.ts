import type { ContextSource, DeployOptions, EventContext, ServiceMetadata } from '@ez4/project/library';
import type { AgentService } from '@ez4/agent/library';
import type { QueueState } from '@ez4/aws-queue';
import type { EcsClusterState, EcsTaskDefState } from '@ez4/aws-ecs';
import { isAgentService, InvalidReplyToError } from '@ez4/agent/library';
import { QueueServiceType } from '@ez4/aws-queue';
import { getDefinitionName } from '@ez4/project/library';
import { createBucketStateId } from '@ez4/aws-bucket';
import { createEcsClusterStateId, createEcsTaskDefStateId } from '@ez4/aws-ecs';
import { getAgentBucketName, getAgentClusterName } from '../utils/names';
export interface LinkedAgentEvent {
  service: ServiceMetadata;
  target?: ServiceMetadata;
  options: DeployOptions;
  context: EventContext;
}

export const prepareLinkedService = (event: LinkedAgentEvent): ContextSource | null => {
  const { service, options, context } = event;

  if (!isAgentService(service)) {
    return null;
  }

  const agent = service as AgentService;
  const replyToOption = agent.options?.replyTo;
  let replyToQueueUrl: string | undefined;
  const dependencyIds: string[] = [];

  if (replyToOption) {
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

    const queueEntryId = (queueState as QueueState).entryId;
    dependencyIds.push(queueEntryId);

    replyToQueueUrl = getDefinitionName<QueueState>(queueEntryId, 'queueUrl');
  }
  const clusterStateId = createEcsClusterStateId(getAgentClusterName(options));
  const taskDefStateId = createEcsTaskDefStateId(agent.name);

  dependencyIds.push(taskDefStateId, clusterStateId, createBucketStateId(getAgentBucketName(options)));

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
    ...(replyToQueueUrl && { replyTo: `@{EZ4_RAW_EXPRESSION}:${replyToQueueUrl}` }),
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
