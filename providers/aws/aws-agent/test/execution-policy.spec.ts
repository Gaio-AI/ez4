// providers/aws/aws-agent/test/execution-policy.spec.ts
import type { PolicyResourceEvent } from '@ez4/project/library';
import type { EntryStates } from '@ez4/state';
import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { buildExecutionPolicy } from '../src/triggers/policy';
import { ServiceType } from '@ez4/agent/library';
import { isPolicyState } from '@ez4/aws-identity';

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
});
