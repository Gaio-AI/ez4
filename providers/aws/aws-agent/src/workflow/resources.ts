import type { EntryState, EntryStates } from '@ez4/state';
import type { AgentWorkflowService, AgentService } from '@ez4/agent/library';
import type { DeployOptions, EventContext, IdentityGrant, LinkedVariables } from '@ez4/project/library';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import type { RoleState, PolicyState } from '@ez4/aws-identity';
import type { QueueState } from '@ez4/aws-queue';
import type { EcsClusterState, EcsTaskDefState } from '@ez4/aws-ecs';

import {
  createPolicy,
  createRole,
  createPolicyDocument,
  createRoleDocument,
  createRoleStatement,
  getRegion,
  getAccountId
} from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';
import { createFunction } from '@ez4/aws-function';
import { createQueue, createMapping } from '@ez4/aws-queue';
import { createEcsClusterStateId, createEcsTaskDefStateId } from '@ez4/aws-ecs';
import { getDefinitionName } from '@ez4/project/library';
import { getFunctionBundle } from '@ez4/aws-common';
import { hashObject, toSnakeCase } from '@ez4/utils';

import { buildAgentInvokeGrants } from '../role/task';
import {
  getAgentBucketName,
  getAgentClusterName,
  getWorkflowFunctionName,
  getWorkflowResultsQueueName,
  getWorkflowStartQueueName
} from '../utils/names';
import { getWorkflowTemplateFile } from './handler';
export type WorkflowResourcePorts = {
  identity?: () => Promise<{ region: string; accountId: string }>;
};

export const buildWorkflowGrants = (
  workflow: AgentWorkflowService,
  region: string,
  accountId: string,
  options: DeployOptions
): IdentityGrant[] => {
  const bucketName = getAgentBucketName(options);
  const startQueueName = getWorkflowStartQueueName(workflow.name, options);
  const resultsQueueName = getWorkflowResultsQueueName(workflow.name, options);
  const logGroupName = getWorkflowFunctionName(workflow.name, options);

  const agentNames = Object.values(workflow.agents ?? {});
  const invokeGrants = buildAgentInvokeGrants(agentNames, region, accountId, options);

  const startQueueArn = `arn:aws:sqs:${region}:${accountId}:${startQueueName}`;
  const resultsQueueArn = `arn:aws:sqs:${region}:${accountId}:${resultsQueueName}`;

  const workflowBucketArn = `arn:aws:s3:::${bucketName}/workflows/${workflow.name}/*`;
  const agentInvocationsArns = agentNames.map((agent) => `arn:aws:s3:::${bucketName}/invocations/${agent}/*`);

  return [
    {
      permissions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
      resourceIds: [startQueueArn, resultsQueueArn]
    },
    {
      permissions: ['s3:GetObject', 's3:PutObject'],
      resourceIds: [workflowBucketArn, ...agentInvocationsArns]
    },
    ...invokeGrants,
    {
      permissions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resourceIds: [`arn:aws:logs:${region}:${accountId}:log-group:${logGroupName}:*`]
    }
  ];
};

export const prepareWorkflowResources = async <E extends EntryState>(
  state: EntryStates<E>,
  workflow: AgentWorkflowService,
  context: EventContext,
  options: DeployOptions,
  ports?: WorkflowResourcePorts
): Promise<void> => {
  const startQueueName = getWorkflowStartQueueName(workflow.name, options);
  const startQueue = createQueue(state, undefined, {
    queueName: startQueueName,
    fifoMode: false,
    tags: {
      ...workflow.tags,
      ...options.tags
    }
  });

  const resultsQueueName = getWorkflowResultsQueueName(workflow.name, options);
  const resultsQueue = createQueue(state, undefined, {
    queueName: resultsQueueName.replace(/\.fifo$/, ''),
    fifoMode: true,
    tags: {
      ...workflow.tags,
      ...options.tags
    }
  });
  let region: string;
  let accountId: string;
  if (ports?.identity) {
    const identity = await ports.identity();
    region = identity.region;
    accountId = identity.accountId;
  } else {
    region = await getRegion();
    accountId = await getAccountId();
  }
  const functionName = getWorkflowFunctionName(workflow.name, options);
  const grants = buildWorkflowGrants(workflow, region, accountId, options);

  const policy = createPolicy(state, {
    policyName: `${functionName}-policy`,
    policyDocument: createPolicyDocument(grants),
    tags: options.tags
  }) as PolicyState;

  const role = createRole(state, [policy], {
    roleName: `${functionName}-role`,
    roleDocument: createRoleDocument([
      createRoleStatement({ permissions: ['sts:AssumeRole'], resourceIds: [] }, [{ account: 'lambda.amazonaws.com' }], accountId)
    ]),
    tags: options.tags
  }) as RoleState;

  const logGroup = createLogGroup(state, {
    groupName: functionName,
    retention: 30,
    tags: options.tags
  });

  const agentDependencies: string[] = [];
  const workflowVariables: LinkedVariables = {
    EZ4_WORKFLOW_NAME: workflow.name,
    EZ4_WORKFLOW_BUCKET: getAgentBucketName(options),
    EZ4_WORKFLOW_MAX_STEPS: String(workflow.maxSteps ?? 10)
  };

  for (const [alias, agentName] of Object.entries(workflow.agents ?? {})) {
    const clusterStateId = createEcsClusterStateId(getAgentClusterName(options));
    const taskDefStateId = createEcsTaskDefStateId(agentName);
    const resultsQueueId = resultsQueue.entryId;

    if (state[clusterStateId]) {
      agentDependencies.push(clusterStateId);
    }
    if (state[taskDefStateId]) {
      agentDependencies.push(taskDefStateId);
    }
    const clusterArn = getDefinitionName<EcsClusterState>(clusterStateId, 'clusterArn');
    const taskDefinitionArn = getDefinitionName<EcsTaskDefState>(taskDefStateId, 'taskDefinitionArn');
    const subnetIds = getDefinitionName<EcsTaskDefState>(taskDefStateId, 'subnetIds');
    const securityGroupIds = getDefinitionName<EcsTaskDefState>(taskDefStateId, 'securityGroupIds');
    const replyToUrl = getDefinitionName<QueueState>(resultsQueueId, 'queueUrl');

    let agentService: AgentService | undefined;
    if (context?.getServiceState) {
      try {
        agentService = context.getServiceState(agentName, options) as unknown as AgentService;
      } catch {
        // ignored
      }
    }

    const clientParameters = {
      alias,
      agentName,
      cluster: clusterArn,
      taskDefinition: taskDefinitionArn,
      bucket: getAgentBucketName(options),
      subnets: subnetIds,
      securityGroups: securityGroupIds,
      replyTo: replyToUrl,
      timeout: agentService?.resources?.timeout ?? 3600,
      inputSchema: agentService?.inputSchema ?? { type: 'object' }
    };

    const envKey = `EZ4_WORKFLOW_AGENT_${toSnakeCase(alias).toUpperCase()}`;
    workflowVariables[envKey] = JSON.stringify(clientParameters);
  }

  const templateFile = getWorkflowTemplateFile();

  const workflowFunction = createFunction(state, role, logGroup, {
    handlerName: 'workflowEntryPoint',
    sourceFile: workflow.handler?.file ?? templateFile,
    dependencies: [startQueue.entryId, resultsQueue.entryId, ...agentDependencies],
    functionName,
    description: workflow.description,
    runtime: RuntimeType.Node22,
    architecture: ArchitectureType.Arm,
    timeout: 60,
    memory: 256,
    tags: {
      ...workflow.tags,
      ...options.tags
    },
    getFunctionVariables: () => workflowVariables,
    getFunctionBundle: () => {
      return getFunctionBundle('@ez4/aws-agent', {
        resourceName: functionName,
        filePrefix: 'workflow',
        templateFile,
        handler: {
          functionName: workflow.handler?.name ?? 'handle',
          sourceFile: workflow.handler?.file ?? templateFile
        },
        target: 'node22'
      });
    },
    getFunctionFiles: () => {
      return [workflow.handler?.file ?? templateFile, [templateFile]];
    },
    getFunctionHash: () => {
      return hashObject({
        functionName,
        workflowVariables
      });
    }
  });

  createMapping(state, startQueue, workflowFunction, {
    fromService: functionName,
    batch: { size: 1 }
  });
  createMapping(state, resultsQueue, workflowFunction, {
    fromService: functionName,
    batch: { size: 1 }
  });

  if (context?.setServiceState) {
    context.setServiceState(workflow, options, workflowFunction);
  }
};
