import type { EntryState, EntryStates } from '@ez4/state';
import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions, IdentityGrant } from '@ez4/project/library';
import type { RoleState, PolicyState } from '@ez4/aws-identity';
import { getServiceName } from '@ez4/project/library';
import { createRole, createPolicy, createPolicyDocument, createRoleDocument, createRoleStatement, getAccountId } from '@ez4/aws-identity';
import { getAgentBucketName, getAgentKey, getAgentsBaseName, getAgentTaskRoleName } from '../utils/names';
import { toKebabCase } from '@ez4/utils';
import { PRESET_POLICIES } from './presets';
import { buildWorkspaceGrants } from '../workspace/resources';

export const buildAgentInvokeGrants = (
  agentNames: string[],
  region: string,
  accountId: string,
  options: DeployOptions
): IdentityGrant[] => {
  if (agentNames.length === 0) {
    return [];
  }
  const baseName = getAgentsBaseName(options);
  const taskDefArns = agentNames.map((name) => `arn:aws:ecs:${region}:${accountId}:task-definition/${baseName}-${toKebabCase(name)}:*`);
  const taskRoleArns = agentNames.map((name) => `arn:aws:iam::${accountId}:role/${getAgentTaskRoleName({ name }, options)}`);
  const executionRoleArn = `arn:aws:iam::${accountId}:role/${baseName}-execution-role`;

  return [
    {
      resourceIds: taskDefArns,
      permissions: ['ecs:RunTask']
    },
    {
      resourceIds: [...taskRoleArns, executionRoleArn],
      permissions: ['iam:PassRole']
    }
  ];
};

export const buildTaskRoleGrants = (
  agent: AgentService,
  linkedAgents: string[],
  bucketName: string,
  options: DeployOptions,
  accountId: string,
  workspaceArns?: { fileSystemArn: string; accessPointArn: string },
  region: string = '*'
): IdentityGrant[] => {
  const agentKey = getAgentKey(agent);

  const grants: IdentityGrant[] = [
    // S3 runtime access: own invocation input, results, and artifacts
    {
      resourceIds: [`arn:aws:s3:::${bucketName}/invocations/${agentKey}/*`],
      permissions: ['s3:GetObject']
    },
    {
      resourceIds: [`arn:aws:s3:::${bucketName}/results/${agentKey}/*`, `arn:aws:s3:::${bucketName}/artifacts/${agentKey}/*`],
      permissions: ['s3:PutObject']
    },
    // Read own artifacts; linked agents' artifacts are granted below.
    {
      resourceIds: [`arn:aws:s3:::${bucketName}/artifacts/${agentKey}/*`],
      permissions: ['s3:GetObject']
    },
    // Heartbeat / task describe
    {
      resourceIds: ['*'],
      permissions: ['ecs:DescribeTasks']
    }
  ];

  if (agent.workspace) {
    const fileSystemArn = workspaceArns?.fileSystemArn ?? `arn:aws:elasticfilesystem:*:${accountId}:file-system/*`;
    const accessPointArn = workspaceArns?.accessPointArn ?? `arn:aws:elasticfilesystem:*:${accountId}:access-point/*`;
    grants.push(...buildWorkspaceGrants(fileSystemArn, accessPointArn));
  }

  for (const linked of linkedAgents) {
    grants.push(
      {
        resourceIds: [`arn:aws:s3:::${bucketName}/invocations/${linked}/*`],
        permissions: ['s3:PutObject']
      },
      {
        resourceIds: [`arn:aws:s3:::${bucketName}/results/${linked}/*`, `arn:aws:s3:::${bucketName}/artifacts/${linked}/*`],
        permissions: ['s3:GetObject']
      }
    );
  }

  if (linkedAgents.length > 0) {
    grants.push(...buildAgentInvokeGrants(linkedAgents, region, accountId, options));
  }

  // Presets
  if (agent.permissions?.presets) {
    for (const preset of agent.permissions.presets) {
      const presetGrant = PRESET_POLICIES[preset];
      if (presetGrant) {
        grants.push(presetGrant);
      }
    }
  }

  // Statements
  if (agent.permissions?.statements) {
    for (const statement of agent.permissions.statements) {
      grants.push({
        resourceIds: [...statement.resources],
        permissions: [...statement.actions]
      });
    }
  }

  return grants;
};

export const buildAgentTaskRole = <E extends EntryState>(
  state: EntryStates<E>,
  agent: AgentService,
  options: DeployOptions,
  accountId: string,
  linkedAgents: string[] = [],
  workspaceArns?: { fileSystemArn: string; accessPointArn: string }
): RoleState => {
  const servicePrefix = getServiceName(agent, options);
  const roleName = getAgentTaskRoleName(agent, options);
  const policyName = `${servicePrefix}-task-policy`;

  const bucketName = getAgentBucketName(options);

  const grants = buildTaskRoleGrants(agent, linkedAgents, bucketName, options, accountId, workspaceArns);

  const policyState = createPolicy(state, {
    policyName,
    policyDocument: createPolicyDocument(grants),
    tags: options.tags
  });

  const roleDocument = createRoleDocument([
    createRoleStatement(
      {
        permissions: ['sts:AssumeRole'],
        resourceIds: []
      },
      [{ account: 'ecs-tasks.amazonaws.com' }],
      accountId
    )
  ]);

  return createRole(state, [policyState as PolicyState], {
    roleName,
    roleDocument,
    tags: options.tags
  });
};

export const createAgentTaskRole = async <E extends EntryState>(
  state: EntryStates<E>,
  agent: AgentService,
  options: DeployOptions,
  linkedAgents: string[] = []
): Promise<RoleState> => {
  return buildAgentTaskRole(state, agent, options, await getAccountId(), linkedAgents);
};
