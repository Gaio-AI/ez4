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
import { getAgentBucketName, getAgentsBaseName } from '../src/utils/names';

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
    equal(role.parameters.roleName, 'ez4-test-stg-agents-code-agent-task-role');

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
    equal(role.parameters.roleName, 'ez4-test-stg-agents-execution-role');

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

  it('assert :: task role keys match runtime keys and allow invoking linked agents', () => {
    const state: EntryStates = {};
    const agent = { ...createAgentService('ImplementAgent'), services: { review: { reference: 'ReviewAgent' } } } as never;
    const role = buildAgentTaskRole(state, agent, options, '123456789012', ['ReviewAgent']);
    const policy = state[role.dependencies[0]] as {
      parameters: { policyDocument: { Statement: { Action: string | string[]; Resource: string | string[] }[] } };
    };
    const statements = policy.parameters.policyDocument.Statement;
    const resources = statements.flatMap((statement) => [statement.Resource].flat());
    const actions = statements.flatMap((statement) => [statement.Action].flat());
    const bucket = getAgentBucketName(options);
    ok(resources.includes(`arn:aws:s3:::${bucket}/invocations/ImplementAgent/*`));
    ok(resources.includes(`arn:aws:s3:::${bucket}/artifacts/ImplementAgent/*`));
    ok(resources.includes(`arn:aws:s3:::${bucket}/artifacts/ReviewAgent/*`));
    ok(!resources.includes(`arn:aws:s3:::${bucket}/artifacts/*`));
    ok(resources.includes(`arn:aws:s3:::${bucket}/invocations/ReviewAgent/*`));
    ok(actions.includes('ecs:RunTask'));
    ok(actions.includes('iam:PassRole'));
  });

  it('does not grant an unlinked agent access to other agents artifacts', () => {
    const state: EntryStates = {};
    const role = buildAgentTaskRole(state, createAgentService('ImplementAgent'), options, accountId);
    const policy = state[role.dependencies[0]] as {
      parameters: { policyDocument: { Statement: { Action: string | string[]; Resource: string | string[] }[] } };
    };
    const readable = policy.parameters.policyDocument.Statement.filter((statement) => [statement.Action].flat().includes('s3:GetObject'));
    const resources = readable.flatMap((statement) => [statement.Resource].flat());
    const bucket = getAgentBucketName(options);
    ok(resources.includes(`arn:aws:s3:::${bucket}/artifacts/ImplementAgent/*`));
    ok(!resources.includes(`arn:aws:s3:::${bucket}/artifacts/ReviewAgent/*`));
    ok(!resources.includes(`arn:aws:s3:::${bucket}/artifacts/*`));
  });

  it('assert :: task role name matches the PassRole resource pattern (glob -> regex)', () => {
    const state: EntryStates = {};
    const agent: AgentService = createAgentService('CodeAgent');
    const role = buildAgentTaskRole(state, agent, options, accountId, ['ReviewAgent']);
    const passRolePattern = `arn:aws:iam::${accountId}:role/${getAgentsBaseName(options)}-*`;
    const passRoleRegex = new RegExp(`^${passRolePattern.replace(/\*/g, '.*')}$`);
    const taskRoleArn = `arn:aws:iam::${accountId}:role/${role.parameters.roleName}`;
    ok(passRoleRegex.test(taskRoleArn));
  });
});
