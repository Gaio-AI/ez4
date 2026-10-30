import type { EntryState, EntryStates } from '@ez4/state';
import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions, IdentityGrant } from '@ez4/project/library';
import type { RoleState, PolicyState } from '@ez4/aws-identity';
import { getAgentsBaseName, getSecretResourceArn } from '../utils/names';
import {
  buildPermissionsBoundaryArn,
  createRole,
  createPolicy,
  createPolicyDocument,
  createRoleDocument,
  createRoleStatement,
  getAccountId,
  getRegion
} from '@ez4/aws-identity';

export const buildAgentExecutionRole = <E extends EntryState>(
  state: EntryStates<E>,
  agent: AgentService,
  options: DeployOptions,
  region: string,
  accountId: string
): RoleState => {
  const servicePrefix = getAgentsBaseName(options);
  const roleName = `${servicePrefix}-execution-role`;

  const attachedPolicies: PolicyState[] = [];

  // Base ECS task execution grants (ECR auth/pull, CloudWatch logs)
  const baseExecutionGrants: IdentityGrant[] = [
    {
      resourceIds: ['*'],
      permissions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ]
    }
  ];

  // Secrets policy for valueFrom injection
  if (agent.secrets && Object.keys(agent.secrets).length > 0) {
    const secretResourceIds = [
      ...new Set(Object.values(agent.secrets).map((secretRef) => getSecretResourceArn(secretRef, region, accountId)))
    ];

    baseExecutionGrants.push({
      resourceIds: secretResourceIds,
      permissions: ['secretsmanager:GetSecretValue']
    });
  }

  const executionPolicyState = createPolicy(state, {
    policyName: `${servicePrefix}-execution-policy`,
    policyDocument: createPolicyDocument(baseExecutionGrants),
    tags: options.tags
  });

  attachedPolicies.push(executionPolicyState as PolicyState);

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

  return createRole(state, attachedPolicies, {
    roleName,
    roleDocument,
    permissionsBoundary: buildPermissionsBoundaryArn(accountId, options.permissionsBoundary),
    tags: options.tags
  });
};

export const createAgentExecutionRole = async <E extends EntryState>(
  state: EntryStates<E>,
  agent: AgentService,
  options: DeployOptions
): Promise<RoleState> => {
  const [region, accountId] = await Promise.all([getRegion(), getAccountId()]);
  return buildAgentExecutionRole(state, agent, options, region, accountId);
};
