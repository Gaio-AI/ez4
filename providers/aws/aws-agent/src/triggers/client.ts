import type { ContextSource, DeployOptions, EventContext, ServiceMetadata, MetadataReflection } from '@ez4/project/library';
import type { AgentService } from '@ez4/agent/library';
import type { QueueService } from '@ez4/queue/library';
import type { QueueState } from '@ez4/aws-queue';
import type { EcsClusterState } from '../cluster/types';
import type { EcsTaskDefState } from '../taskdef/types';
import { isAgentService, InvalidReplyToError } from '@ez4/agent/library';
import { isQueueService } from '@ez4/queue/library';
import { getDefinitionName } from '@ez4/project/library';
import { createBucketStateId } from '@ez4/aws-bucket';
import { createEcsClusterStateId } from '../cluster/service';
import { createEcsTaskDefStateId } from '../taskdef/service';
import { getAgentBucketName, getAgentClusterName } from '../utils/names';

export interface LinkedAgentEvent {
  service: ServiceMetadata;
  target?: ServiceMetadata;
  options: DeployOptions;
  context: EventContext;
  metadata?: MetadataReflection;
}

export const prepareLinkedService = (event: LinkedAgentEvent): ContextSource | null => {
  const { service, options, context, metadata } = event;

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

    const referencedService = metadata?.[replyToOption];
    if (!referencedService || !isQueueService(referencedService)) {
      throw new InvalidReplyToError(replyToOption, agent.file);
    }

    const queueService = referencedService as QueueService;
    if (!queueService.fifoMode) {
      throw new InvalidReplyToError(replyToOption, agent.file);
    }

    const queueState = context.getServiceState(replyToOption, options);
    const queueEntryId = queueState.entryId;
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
