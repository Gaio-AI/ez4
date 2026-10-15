import type { EntryState, EntryStates } from '@ez4/state';
import type { AgentWorkflowService } from '@ez4/agent/library';
import type { ContextSource, DeployOptions, EventContext, IdentityGrant, LinkedVariables, MetadataReflection } from '@ez4/project/library';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import type { RoleState, PolicyState } from '@ez4/aws-identity';

import {
  createPolicy,
  createRole,
  createPolicyDocument,
  createRoleDocument,
  createRoleStatement,
  getRegion,
  getAccountId
} from '@ez4/aws-identity';
import { isAgentService } from '@ez4/agent/library';
import { createLogGroup } from '@ez4/aws-logs';
import { createFunction } from '@ez4/aws-function';
import { createQueue, createMapping } from '@ez4/aws-queue';
import { getDefinitionsObject } from '@ez4/project/library';
import { getFunctionBundle } from '@ez4/aws-common';
import { hashObject } from '@ez4/utils';

import { buildAgentInvokeGrants } from '../role/task';
import { getAgentClientSource } from '../triggers/client';
import {
  getAgentBucketName,
  getWorkflowAgentContextName,
  getWorkflowFunctionName,
  getWorkflowResultsQueueName,
  getWorkflowStartQueueName
} from '../utils/names';
import { getWorkflowTemplateFile } from './handler';

// SQS rejects a mapping whose queue visibility timeout is shorter than the function timeout.
const WORKFLOW_FUNCTION_TIMEOUT = 60;

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
    // Without ListBucket a missing run reads as AccessDenied instead of NoSuchKey, so no run could ever start.
    { permissions: ['s3:ListBucket'], resourceIds: [`arn:aws:s3:::${bucketName}`] },
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
  metadata: MetadataReflection,
  context: EventContext,
  options: DeployOptions,
  ports?: WorkflowResourcePorts
): Promise<void> => {
  const startQueueName = getWorkflowStartQueueName(workflow.name, options);
  const startQueue = createQueue(state, undefined, {
    queueName: startQueueName,
    timeout: WORKFLOW_FUNCTION_TIMEOUT,
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
    timeout: WORKFLOW_FUNCTION_TIMEOUT,
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

  const workflowVariables: LinkedVariables = {
    EZ4_WORKFLOW_NAME: workflow.name,
    EZ4_WORKFLOW_BUCKET: getAgentBucketName(options),
    EZ4_WORKFLOW_MAX_STEPS: String(workflow.maxSteps ?? 10)
  };

  // Agent clients join the workflow's linked context, so the bundler resolves their entries and connect links them.
  const agentContext: Record<string, ContextSource> = {};

  for (const [alias, agentName] of Object.entries(workflow.agents ?? {})) {
    const agent = Object.values(metadata)
      .filter(isAgentService)
      .find((service) => service.name === agentName);

    if (!agent) {
      throw new Error(`Agent '${agentName}' of workflow '${workflow.name}' is not declared in the project.`);
    }

    agentContext[getWorkflowAgentContextName(alias)] = getAgentClientSource(agent, options, resultsQueue.entryId);
  }

  workflow.context = { ...workflow.context, ...agentContext };

  const templateFile = getWorkflowTemplateFile();

  const workflowFunction = createFunction(state, role, logGroup, {
    handlerName: 'workflowEntryPoint',
    sourceFile: workflow.handler?.file ?? templateFile,
    dependencies: [startQueue.entryId, resultsQueue.entryId],
    functionName,
    description: workflow.description,
    runtime: RuntimeType.Node22,
    architecture: ArchitectureType.Arm,
    timeout: WORKFLOW_FUNCTION_TIMEOUT,
    memory: 256,
    tags: {
      ...workflow.tags,
      ...options.tags
    },
    // Project and workflow variables reach the handler (`context.variables`) like any other function's.
    getFunctionVariables: () => ({ ...options.variables, ...workflow.variables, ...workflowVariables }),
    getFunctionBundle: (stepContext) => {
      return getFunctionBundle('@ez4/aws-agent', {
        resourceName: functionName,
        filePrefix: 'workflow',
        templateFile,
        context: workflow.context,
        define: getDefinitionsObject([...stepContext.getDependencies(), ...stepContext.getConnections()]),
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
