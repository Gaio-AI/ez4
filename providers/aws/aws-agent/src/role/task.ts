import type { EntryState, EntryStates } from '@ez4/state';
import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions, IdentityGrant } from '@ez4/project/library';
import type { RoleState, PolicyState } from '@ez4/aws-identity';
import { getServiceName } from '@ez4/project/library';
import { createRole, createPolicy, createPolicyDocument, createRoleDocument, createRoleStatement, getAccountId } from '@ez4/aws-identity';
import { toKebabCase } from '@ez4/utils';
import { PRESET_POLICIES } from './presets';

export const buildAgentTaskRole = <E extends EntryState>(
  state: EntryStates<E>,
  agent: AgentService,
  options: DeployOptions,
  accountId: string
): RoleState => {
  const servicePrefix = getServiceName(agent, options);
  const roleName = `${servicePrefix}-task-role`;
  const policyName = `${servicePrefix}-task-policy`;

  const agentKebabName = toKebabCase(agent.name);
  const basePrefix = getServiceName('', options);

  const grants: IdentityGrant[] = [
    // S3 runtime access: own invocation input, results, and artifacts
    {
      resourceIds: [`arn:aws:s3:::${basePrefix}-agents/invocations/${agentKebabName}/*`],
      permissions: ['s3:GetObject']
    },
    {
      resourceIds: [
        `arn:aws:s3:::${basePrefix}-agents/results/${agentKebabName}/*`,
        `arn:aws:s3:::${basePrefix}-agents/artifacts/${agentKebabName}/*`
      ],
      permissions: ['s3:PutObject']
    },
    // Heartbeat / task describe
    {
      resourceIds: ['*'],
      permissions: ['ecs:DescribeTasks']
    }
  ];

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
  options: DeployOptions
): Promise<RoleState> => {
  return buildAgentTaskRole(state, agent, options, await getAccountId());
};
