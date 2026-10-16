// providers/aws/aws-agent/test/execution-policy.spec.ts
import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions, PolicyResourceEvent } from '@ez4/project/library';
import type { EntryStates } from '@ez4/state';
import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { createAgentService, createAgentWorkflowService, ServiceType } from '@ez4/agent/library';
import { isPolicyState } from '@ez4/aws-identity';
import { buildAgentExecutionRole } from '../src/role/execution';
import { buildExecutionPolicy } from '../src/triggers/policy';
import { getAgentBucketName } from '../src/utils/names';
describe('agent execution policy isolation', () => {
  const region = 'us-east-1';
  const accountId = '123456789012';

  it('assert :: prepareExecutionPolicy does NOT contain agent preset actions', () => {
    const state: EntryStates = {};
    const event: PolicyResourceEvent = {
      state,
      serviceType: ServiceType,
      metadata: {},
      options: { prefix: 'ez4', projectName: 'test', branchName: 'stg', lockId: 'test-lock' }
    };

    const policyState = buildExecutionPolicy(event, region, accountId);
    ok(policyState);
    ok(isPolicyState(policyState));

    const policyStatements = policyState.parameters.policyDocument.Statement;
    for (const statement of policyStatements) {
      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      equal(actions.includes('lambda:GetFunction'), false);
      equal(actions.includes('logs:GetLogEvents'), false);
      equal(actions.includes('cloudformation:DescribeStacks'), false);
    }
  });

  it('assert :: buildAgentExecutionRole grants exact secret resources for names, json keys, and ARNs', () => {
    const state: EntryStates = {};
    const options: DeployOptions = {
      prefix: 'ez4',
      projectName: 'test',
      branchName: 'stg',
      lockId: 'test-lock'
    };

    const agent: AgentService = {
      ...createAgentService('CodeAgent'),
      secrets: {
        A: 'prd/app:KEY',
        B: 'stg/agents/claude',
        C: 'arn:aws:secretsmanager:us-east-1:1:secret:x-AbCdEf:k::'
      }
    };

    const role = buildAgentExecutionRole(state, agent, options, region, accountId);
    ok(role);
    equal(role.dependencies.length, 1);

    const policyState = state[role.dependencies[0]];
    ok(policyState);
    ok(isPolicyState(policyState));

    const statements = policyState.parameters.policyDocument.Statement;
    const secretStatement = statements.find((stmt) => {
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
      return actions.includes('secretsmanager:GetSecretValue');
    });

    ok(secretStatement);
    const resources = Array.isArray(secretStatement.Resource) ? secretStatement.Resource : [secretStatement.Resource];
    deepEqual(resources, [
      `arn:aws:secretsmanager:${region}:${accountId}:secret:prd/app-*`,
      `arn:aws:secretsmanager:${region}:${accountId}:secret:stg/agents/claude-*`,
      'arn:aws:secretsmanager:us-east-1:1:secret:x-AbCdEf'
    ]);
  });

  it('assert :: caller policy grants name exact task definitions for declared agents', () => {
    const state: EntryStates = {};
    const reviewer = createAgentService('Reviewer');
    const event: PolicyResourceEvent = {
      state,
      serviceType: ServiceType,
      metadata: { Reviewer: reviewer },
      options: { prefix: 'ez4', projectName: 'test', branchName: 'stg', lockId: 'test-lock' }
    };

    const policyState = buildExecutionPolicy(event, region, accountId);
    ok(policyState);
    ok(isPolicyState(policyState));

    const statements = policyState.parameters.policyDocument.Statement;
    ok(!JSON.stringify(statements).includes('agents-*'));

    const runTask = statements.find((stmt) => {
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
      return actions.includes('ecs:RunTask');
    });
    ok(runTask);
    deepEqual(runTask.Resource, [`arn:aws:ecs:${region}:${accountId}:task-definition/ez4-test-stg-agents-reviewer:*`]);

    const passRole = statements.find((stmt) => {
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
      return actions.includes('iam:PassRole');
    });
    ok(passRole);
    deepEqual([passRole.Resource].flat().sort(), [
      `arn:aws:iam::${accountId}:role/ez4-test-stg-agents-execution-role`,
      `arn:aws:iam::${accountId}:role/ez4-test-stg-agents-reviewer-task-role`
    ]);
  });

  it('assert :: workflow callers can enqueue starts and read workflow objects without agent invoke grants', () => {
    const options: DeployOptions = { prefix: 'ez4', projectName: 'test', branchName: 'stg', lockId: 'test-lock' };
    const event: PolicyResourceEvent = {
      state: {},
      serviceType: ServiceType,
      metadata: { ReviewLoop: createAgentWorkflowService('ReviewLoop') },
      options
    };
    const policyState = buildExecutionPolicy(event, region, accountId);
    ok(policyState);
    ok(isPolicyState(policyState));

    const statements = policyState.parameters.policyDocument.Statement;
    const send = statements.find((statement) => [statement.Action].flat().includes('sqs:SendMessage'));
    ok(send);
    deepEqual(send.Resource, ['arn:aws:sqs:us-east-1:123456789012:ez4-test-stg-agents-review-loop-start']);
    const read = statements.find(
      (statement) =>
        [statement.Action].flat().includes('s3:GetObject') &&
        [statement.Resource].flat().includes(`arn:aws:s3:::${getAgentBucketName(options)}/workflows/ReviewLoop/*`)
    );
    ok(read);
    equal(
      statements.some((statement) => [statement.Action].flat().includes('ecs:RunTask')),
      false
    );
    equal(
      statements.some((statement) => [statement.Action].flat().includes('iam:PassRole')),
      false
    );
  });
});
