import type { EntryState, EntryStates } from '@ez4/state';
import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions, IdentityGrant } from '@ez4/project/library';
import type { RoleState, PolicyState } from '@ez4/aws-identity';
import { getServiceName } from '@ez4/project/library';
import { createRole, createPolicy, createPolicyDocument, createRoleDocument, createRoleStatement, getAccountId } from '@ez4/aws-identity';
import { getAgentBucketName, getAgentKey, getAgentsBaseName } from '../utils/names';
import { PRESET_POLICIES } from './presets';

export const buildAgentTaskRole = <E extends EntryState>(
  state: EntryStates<E>,
  agent: AgentService,
  options: DeployOptions,
  accountId: string,
  linkedAgents: string[] = []
): RoleState => {
  const servicePrefix = getServiceName(agent, options);
  const roleName = `${servicePrefix}-task-role`;
  const policyName = `${servicePrefix}-task-policy`;

  const bucketName = getAgentBucketName(options);
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
    // Read of every agent's artifacts
    {
      resourceIds: [`arn:aws:s3:::${bucketName}/artifacts/*`],
      permissions: ['s3:GetObject']
    },
    // Heartbeat / task describe
    {
      resourceIds: ['*'],
      permissions: ['ecs:DescribeTasks']
    }
  ];

  for (const linked of linkedAgents) {
    grants.push(
      {
        resourceIds: [`arn:aws:s3:::${bucketName}/invocations/${linked}/*`],
        permissions: ['s3:PutObject']
      },
      {
        resourceIds: [`arn:aws:s3:::${bucketName}/results/${linked}/*`],
        permissions: ['s3:GetObject']
      }
    );
  }

  if (linkedAgents.length > 0) {
    const baseName = getAgentsBaseName(options);
    grants.push(
      {
        resourceIds: [`arn:aws:ecs:*:${accountId}:task-definition/${baseName}-*`],
        permissions: ['ecs:RunTask']
      },
      {
        resourceIds: [`arn:aws:iam::${accountId}:role/${baseName}-*`],
        permissions: ['iam:PassRole']
      }
    );
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
