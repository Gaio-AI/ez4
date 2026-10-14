// providers/aws/aws-agent/test/task-role.spec.ts
import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions } from '@ez4/project/library';
import type { EntryStates } from '@ez4/state';
import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { createAgentService } from '@ez4/agent/library';
import { buildAgentTaskRole } from '../src/role/task';
import { buildAgentExecutionRole } from '../src/role/execution';
import { RoleServiceType } from '@ez4/aws-identity';

describe('agent task and execution roles', () => {
  const options: DeployOptions = {
    prefix: 'ez4',
    projectName: 'test',
    branchName: 'stg',
    lockId: 'test-lock'
  };

  const region = 'us-east-1';
  const accountId = '123456789012';

  it('assert :: createAgentTaskRole creates role with ecs-tasks trust and source account condition', () => {
    const state: EntryStates = {};
    const agent: AgentService = {
      ...createAgentService('CodeAgent'),
      permissions: {
        presets: ['logs-read', 'lambda-read'],
        statements: [
          {
            actions: ['s3:GetObject'],
            resources: ['arn:aws:s3:::custom-bucket/*']
          }
        ]
      }
    };

    const role = buildAgentTaskRole(state, agent, options, accountId);
    ok(role);
    equal(role.type, RoleServiceType);
    equal(role.parameters.roleName, 'ez4-test-stg-code-agent-task-role');

    const trustStatement = role.parameters.roleDocument.Statement[0];
    ok(trustStatement);
    equal(trustStatement.Effect, 'Allow');
    ok('Service' in trustStatement.Principal);
    equal(
      Array.isArray(trustStatement.Principal.Service) ? trustStatement.Principal.Service[0] : trustStatement.Principal.Service,
      'ecs-tasks.amazonaws.com'
    );
    ok(trustStatement.Condition?.StringEquals);
    equal(
      trustStatement.Condition.StringEquals['AWS:SourceAccount'] || trustStatement.Condition.StringEquals['aws:SourceAccount'],
      '123456789012'
    );

    // Check attached policy dependency exists in state
    equal(role.dependencies.length, 1);
    const policyState = state[role.dependencies[0]];
    ok(policyState);
  });

  it('assert :: createAgentExecutionRole creates execution role with ecs-tasks trust and secrets policy if defined', () => {
    const state: EntryStates = {};
    const agent: AgentService = {
      ...createAgentService('CodeAgent'),
      secrets: {
        GITHUB_TOKEN: 'github/token'
      }
    };

    const role = buildAgentExecutionRole(state, agent, options, region, accountId);
    ok(role);
    equal(role.type, RoleServiceType);
    equal(role.parameters.roleName, 'ez4-test-stg-code-agent-execution-role');

    const trustStatement = role.parameters.roleDocument.Statement[0];
    ok(trustStatement);
    ok('Service' in trustStatement.Principal);
    equal(
      Array.isArray(trustStatement.Principal.Service) ? trustStatement.Principal.Service[0] : trustStatement.Principal.Service,
      'ecs-tasks.amazonaws.com'
    );

    // Should have policy dependency for secrets
    equal(role.dependencies.length, 1);
  });
});
