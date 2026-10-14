// providers/aws/aws-agent/test/execution-policy.spec.ts
import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions, PolicyResourceEvent } from '@ez4/project/library';
import type { EntryStates } from '@ez4/state';
import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { createAgentService, ServiceType } from '@ez4/agent/library';
import { isPolicyState } from '@ez4/aws-identity';
import { buildAgentExecutionRole } from '../src/role/execution';
import { buildExecutionPolicy } from '../src/triggers/policy';
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
});
