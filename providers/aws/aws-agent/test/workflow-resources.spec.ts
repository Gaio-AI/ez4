import type { AgentService, AgentWorkflowService } from '@ez4/agent/library';
import type { DeployOptions, EventContext, MetadataReflection } from '@ez4/project/library';
import type { EntryState, EntryStates } from '@ez4/state';
import type { QueueState } from '@ez4/aws-queue';
import type { EcsTaskDefState } from '@ez4/aws-ecs';
import { createEcsTaskDefStateId } from '@ez4/aws-ecs';
import { describe, it } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { createAgentService, createAgentWorkflowService } from '@ez4/agent/library';
import { isQueueState, QueueServiceType } from '@ez4/aws-queue';
import { isFunctionState, isMappingState } from '@ez4/aws-function';
import { getDefinitionName } from '@ez4/project/library';
import { hashData } from '@ez4/utils';
import { SchemaType } from '@ez4/schema';
import { buildWorkflowGrants, prepareWorkflowResources } from '../src/workflow/resources';
import { prepareLinkedService } from '../src/triggers/client';
import {
  getAgentBucketName,
  getWorkflowAgentContextName,
  getWorkflowResultsQueueName,
  getWorkflowStartQueueName
} from '../src/utils/names';

describe('workflow resources and grants', () => {
  const options: DeployOptions = {
    prefix: 'stg',
    projectName: 'proj',
    branchName: 'main',
    lockId: 'test-lock'
  };

  const workflowFixture: AgentWorkflowService = {
    ...createAgentWorkflowService('ReviewLoop'),
    inputSchema: { type: SchemaType.Object, properties: {} },
    agents: {
      worker: 'Worker'
    },
    handler: {
      name: 'handle',
      file: 'test/fixtures/workflow.ts',
      position: [1, 1]
    }
  };

  const workerFixture = {
    ...createAgentService('Worker'),
    inputSchema: { type: SchemaType.Object, properties: { message: { type: SchemaType.String } } }
  } as AgentService;

  const metadata: MetadataReflection = { Worker: workerFixture };

  const mockContext: EventContext = {
    role: null,
    getServiceState: () => {
      throw new Error('Not found');
    },
    setServiceState: () => {},
    getVirtualServiceState: () => undefined,
    setVirtualServiceState: () => {},
    getDependencyFiles: () => []
  };

  const prepareFor = async (workflow: AgentWorkflowService): Promise<EntryStates> => {
    const state: EntryStates = {};
    await prepareWorkflowResources(state, workflow, metadata, mockContext, options, {
      identity: async () => ({ region: 'us-east-1', accountId: '123' })
    });
    return state;
  };

  it('assert :: a workflow gets its queues, function and mappings', async () => {
    const state = await prepareFor(workflowFixture);
    const isEntry = (e: EntryState | undefined): e is EntryState => !!e;
    const entries = Object.values(state).filter(isEntry);
    const queues = entries
      .filter(isQueueState)
      .map((e) => e.parameters.queueName)
      .sort();
    deepEqual(queues, ['stg-proj-main-agents-review-loop-results.fifo', 'stg-proj-main-agents-review-loop-start']);
    deepEqual(entries.filter(isMappingState).length, 2);

    const functions = entries.filter(isFunctionState);
    equal(functions.length, 1);
    const fn = functions[0];
    equal(fn.parameters.functionName, 'stg-proj-main-agents-review-loop');
    for (const queue of entries.filter(isQueueState)) {
      ok((queue.parameters.timeout ?? 30) >= fn.parameters.timeout!, `${queue.parameters.queueName} visibility shorter than the function`);
    }
  });

  it('assert :: workflow role runs only its declared agents', async () => {
    const grants = buildWorkflowGrants(workflowFixture, 'us-east-1', '123', options);
    const runTask = grants.find((g) => g.permissions.includes('ecs:RunTask'))!;
    ok(runTask);
    deepEqual(runTask.resourceIds, ['arn:aws:ecs:us-east-1:123:task-definition/stg-proj-main-agents-worker:*']);
    const tagTask = grants.find((g) => g.permissions.includes('ecs:TagResource'))!;
    deepEqual(tagTask.resourceIds, ['arn:aws:ecs:us-east-1:123:task/stg-proj-main-agents/*']);
    const passRole = grants.find((g) => g.permissions.includes('iam:PassRole'))!;
    ok(passRole);
    deepEqual(passRole.resourceIds.sort(), [
      'arn:aws:iam::123:role/stg-proj-main-agents-execution-role',
      'arn:aws:iam::123:role/stg-proj-main-agents-worker-task-role'
    ]);

    const sqsGrant = grants.find((g) => g.permissions.includes('sqs:ReceiveMessage'))!;
    ok(sqsGrant);
    deepEqual(sqsGrant.resourceIds.sort(), [
      'arn:aws:sqs:us-east-1:123:stg-proj-main-agents-review-loop-results.fifo',
      'arn:aws:sqs:us-east-1:123:stg-proj-main-agents-review-loop-start'
    ]);

    const s3Grant = grants.find((g) => g.permissions.includes('s3:GetObject'))!;
    ok(s3Grant);
    const bucketName = getAgentBucketName(options);
    deepEqual(s3Grant.resourceIds.sort(), [
      `arn:aws:s3:::${bucketName}/invocations/Worker/*`,
      `arn:aws:s3:::${bucketName}/workflows/ReviewLoop/*`
    ]);
    ok(grants.some((g) => g.permissions.includes('s3:ListBucket') && g.resourceIds.includes(`arn:aws:s3:::${bucketName}`)));
  });

  it('assert :: each agent alias is bundled as a client that replies to the workflow results queue', async () => {
    const workflow: AgentWorkflowService = { ...workflowFixture, agents: { reviewLoop: 'Worker' } };
    const state = await prepareFor(workflow);

    const source = workflow.context?.[getWorkflowAgentContextName('reviewLoop')];
    ok(source);
    equal(source.module, 'Client');
    equal(source.from, '@ez4/aws-agent/client');

    // Resolved from deployed entries in code, never left as literal placeholders.
    const resultsQueueName = getWorkflowResultsQueueName(workflow.name, options);
    const resultsQueueId = Object.values(state)
      .filter((entry): entry is EntryState => !!entry)
      .filter(isQueueState)
      .find((queue) => queue.parameters.queueName === resultsQueueName)!.entryId;
    ok(source.constructor.includes(`"replyTo":${getDefinitionName<QueueState>(resultsQueueId, 'queueUrl')}`));
    ok(source.dependencyIds?.includes(resultsQueueId));
    ok(source.constructor.includes(`"inputSchema":${JSON.stringify(workerFixture.inputSchema)}`));
    // A revision ARN would pin the function to the revision deployed when it was bundled.
    ok(source.constructor.includes(`"taskDefinition":${getDefinitionName<EcsTaskDefState>(createEcsTaskDefStateId('Worker'), 'family')}`));
  });

  it('assert :: a workflow agent missing from the project fails the deploy', async () => {
    await rejects(prepareFor({ ...workflowFixture, agents: { ghost: 'Ghost' } }), /Agent 'Ghost' of workflow 'ReviewLoop'/);
  });

  it('assert :: prepareLinkedService returns WorkflowClient for workflow service', async () => {
    const source = prepareLinkedService({
      service: workflowFixture,
      options,
      context: mockContext
    });

    ok(source);
    equal(source.module, 'WorkflowClient');
    equal(source.from, '@ez4/aws-agent/client');
    ok(source.constructor.includes('@{EZ4_MODULE_IMPORT}.make('));
    const startQueueName = getWorkflowStartQueueName(workflowFixture.name, options);
    const startQueueId = hashData(QueueServiceType, startQueueName);
    ok(source.constructor.includes(getDefinitionName<QueueState>(startQueueId, 'queueUrl')));
    ok(source.constructor.includes(`"workflow":"${workflowFixture.name}"`));
    ok(source.constructor.includes(`"bucket":"${getAgentBucketName(options)}"`));
    ok(source.constructor.includes(`"inputSchema":${JSON.stringify(workflowFixture.inputSchema)}`));
    equal(source.dependencyIds?.length, 1);
  });
});
