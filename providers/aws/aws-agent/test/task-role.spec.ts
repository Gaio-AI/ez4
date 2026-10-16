// providers/aws/aws-agent/test/task-role.spec.ts
import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions } from '@ez4/project/library';
import type { EntryStates } from '@ez4/state';
import { describe, it } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import { AgentPermission } from '@ez4/agent';
import { createAgentService } from '@ez4/agent/library';
import { buildAgentTaskRole, buildTaskRoleGrants } from '../src/role/task';
import { buildPermissionGrants } from '../src/role/permissions';
import { buildAgentExecutionRole } from '../src/role/execution';
import { RoleServiceType } from '@ez4/aws-identity';
import { getAgentBucketName } from '../src/utils/names';

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
        grants: [{ permission: AgentPermission.LogsRead, resources: ['api-*'] }],
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
    ok(resources.includes(`arn:aws:ecs:*:${accountId}:task-definition/ez4-test-stg-agents-review-agent:*`));
    ok(resources.includes(`arn:aws:iam::${accountId}:role/ez4-test-stg-agents-review-agent-task-role`));
    ok(resources.includes(`arn:aws:iam::${accountId}:role/ez4-test-stg-agents-execution-role`));
    ok(!resources.some((r) => r.includes('task-definition/ez4-test-stg-agents-*')));
    ok(!resources.some((r) => r.includes('role/ez4-test-stg-agents-*')));
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

  it('assert :: linked agent grants name exact task definitions', () => {
    const callerAgent = createAgentService('CallerAgent');
    const grants = buildTaskRoleGrants(callerAgent, ['Reviewer'], 'bucket', options, accountId);
    ok(!JSON.stringify(grants).includes('agents-*'));
    const runTask = grants.find((g) => g.permissions.includes('ecs:RunTask'))!;
    ok(runTask);
    equal(runTask.resourceIds[0], `arn:aws:ecs:*:${accountId}:task-definition/ez4-test-stg-agents-reviewer:*`);
    const passRole = grants.find((g) => g.permissions.includes('iam:PassRole'))!;
    ok(passRole);
    ok(passRole.resourceIds.includes(`arn:aws:iam::${accountId}:role/ez4-test-stg-agents-reviewer-task-role`));
    ok(passRole.resourceIds.includes(`arn:aws:iam::${accountId}:role/ez4-test-stg-agents-execution-role`));
  });

  it('assert :: a logs grant reads only the named log groups of the deployed environment', () => {
    const grants = buildPermissionGrants(
      { grants: [{ permission: AgentPermission.LogsRead, resources: ['console-*', 'billing-worker'] }] },
      { ...options, prefix: 'prd' },
      region,
      accountId
    );

    const events = grants.find((grant) => grant.permissions.includes('logs:FilterLogEvents'));
    deepEqual(events?.resourceIds, [
      `arn:aws:logs:${region}:${accountId}:log-group:prd-console-*`,
      `arn:aws:logs:${region}:${accountId}:log-group:prd-console-*:*`,
      `arn:aws:logs:${region}:${accountId}:log-group:prd-billing-worker`,
      `arn:aws:logs:${region}:${accountId}:log-group:prd-billing-worker:*`
    ]);

    // Only actions IAM cannot scope by log group get a wildcard resource.
    const unscoped = grants.filter((grant) => grant.resourceIds.includes('*')).flatMap((grant) => grant.permissions);
    deepEqual(unscoped, ['logs:GetQueryResults', 'logs:StopQuery']);
  });

  it('assert :: a CodeArtifact grant reads the named account repository without the deploy prefix', () => {
    const grants = buildPermissionGrants(
      { grants: [{ permission: AgentPermission.CodeArtifactRead, resources: ['acme/npm'] }] },
      { ...options, prefix: 'prd' },
      region,
      accountId
    );

    deepEqual(grants, [
      {
        resourceIds: [`arn:aws:codeartifact:${region}:${accountId}:domain/acme`],
        permissions: ['codeartifact:GetAuthorizationToken']
      },
      {
        resourceIds: [`arn:aws:codeartifact:${region}:${accountId}:repository/acme/npm`],
        permissions: ['codeartifact:GetRepositoryEndpoint', 'codeartifact:ReadFromRepository']
      },
      {
        resourceIds: ['*'],
        permissions: ['sts:GetServiceBearerToken'],
        conditions: { StringEquals: { 'sts:AWSServiceName': 'codeartifact.amazonaws.com' } }
      }
    ]);
  });

  it('assert :: statements keep their resource ARNs as declared', () => {
    const [grant] = buildPermissionGrants(
      { statements: [{ actions: ['s3:GetObject'], resources: ['arn:aws:s3:::reports/${aws:PrincipalTag/team}/*'] }] },
      { ...options, prefix: 'stg' },
      region,
      accountId
    );

    deepEqual(grant.resourceIds, ['arn:aws:s3:::reports/${aws:PrincipalTag/team}/*']);
  });
});
