import type { AgentWorkflowService } from '@ez4/agent/library';
import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { EntryState, EntryStates } from '@ez4/state';
import type { QueueState } from '@ez4/aws-queue';
import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { createAgentWorkflowService } from '@ez4/agent/library';
import { isQueueState, QueueServiceType } from '@ez4/aws-queue';
import { isFunctionState, isMappingState } from '@ez4/aws-function';
import { getDefinitionName } from '@ez4/project/library';
import { hashData } from '@ez4/utils';
import { buildWorkflowGrants, prepareWorkflowResources } from '../src/workflow/resources';
import { getInvoker } from '../src/workflow/template';
import { prepareLinkedService } from '../src/triggers/client';
import { getAgentBucketName, getWorkflowStartQueueName } from '../src/utils/names';
describe('workflow resources and grants', () => {
  const options: DeployOptions = {
    prefix: 'stg',
    projectName: 'proj',
    branchName: 'main',
    lockId: 'test-lock'
  };

  const workflowFixture: AgentWorkflowService = {
    ...createAgentWorkflowService('ReviewLoop'),
    agents: {
      worker: 'Worker'
    },
    handler: {
      name: 'handle',
      file: 'test/fixtures/workflow.ts',
      position: [1, 1]
    }
  };

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
    await prepareWorkflowResources(state, workflow, mockContext, options, {
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
  });

  it('assert :: workflow role runs only its declared agents', async () => {
    const grants = buildWorkflowGrants(workflowFixture, 'us-east-1', '123', options);
    const runTask = grants.find((g) => g.permissions.includes('ecs:RunTask'))!;
    ok(runTask);
    deepEqual(runTask.resourceIds, ['arn:aws:ecs:us-east-1:123:task-definition/stg-proj-main-agents-worker:*']);
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
  });

  it('assert :: a camelCase agent alias resolves from generated workflow variables', async () => {
    const state = await prepareFor({
      ...workflowFixture,
      agents: { reviewLoop: 'Worker' }
    });
    const workflowFunction = Object.values(state).filter((entry): entry is EntryState => !!entry).filter(isFunctionState)[0];
    ok(workflowFunction);
    const variables = await workflowFunction.parameters.getFunctionVariables();
    const clientConfig = variables.EZ4_WORKFLOW_AGENT_REVIEW_LOOP;
    ok(clientConfig);
    const previous = process.env.EZ4_WORKFLOW_AGENT_REVIEW_LOOP;
    process.env.EZ4_WORKFLOW_AGENT_REVIEW_LOOP = clientConfig;
    try {
      const invoke = getInvoker('ReviewLoop');
      await invoke('reviewLoop', null, {}).then(
        () => {
          throw new Error('Unexpected successful agent invocation');
        },
        (error: Error) => ok(error.message.startsWith('Agent input validation failed:'), error.message)
      );
    } finally {
      if (previous === undefined) delete process.env.EZ4_WORKFLOW_AGENT_REVIEW_LOOP;
      else process.env.EZ4_WORKFLOW_AGENT_REVIEW_LOOP = previous;
    }
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
    equal(source.dependencyIds?.length, 1);
  });
});
