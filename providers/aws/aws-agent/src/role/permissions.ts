import type { Agent } from '@ez4/agent';
import type { DeployOptions, IdentityGrant } from '@ez4/project/library';

import { AgentPermission } from '@ez4/agent';
import { toKebabCase } from '@ez4/utils';

type PermissionPolicy = {
  permissions: string[];

  /**
   * ARNs of a named resource the actions apply to; actions without resource-level permissions omit it and get `*`.
   */
  getArns?: (name: string, region: string, accountId: string) => string[];
};

export const PERMISSION_POLICIES: Record<AgentPermission, PermissionPolicy[]> = {
  [AgentPermission.LogsRead]: [
    {
      // IAM cannot narrow the listing to a prefix: every group name is visible, its events are not.
      permissions: ['logs:DescribeLogGroups'],
      getArns: (_name, region, accountId) => [`arn:aws:logs:${region}:${accountId}:log-group:*`]
    },
    {
      permissions: ['logs:DescribeLogStreams', 'logs:GetLogEvents', 'logs:FilterLogEvents', 'logs:StartQuery'],
      getArns: (name, region, accountId) => [
        `arn:aws:logs:${region}:${accountId}:log-group:${name}`,
        `arn:aws:logs:${region}:${accountId}:log-group:${name}:*`
      ]
    },
    {
      permissions: ['logs:GetQueryResults', 'logs:StopQuery']
    }
  ],
  [AgentPermission.LambdaRead]: [
    {
      permissions: [
        'lambda:GetFunctionUrlConfig',
        'lambda:GetPolicy',
        'lambda:GetAlias',
        'lambda:ListAliases',
        'lambda:ListVersionsByFunction',
        'lambda:ListFunctionUrlConfigs'
      ],
      getArns: (name, region, accountId) => [
        `arn:aws:lambda:${region}:${accountId}:function:${name}`,
        `arn:aws:lambda:${region}:${accountId}:function:${name}:*`
      ]
    },
    {
      permissions: ['lambda:ListEventSourceMappings']
    }
  ],
  [AgentPermission.EcsRead]: [
    {
      permissions: ['ecs:DescribeClusters'],
      getArns: (name, region, accountId) => [`arn:aws:ecs:${region}:${accountId}:cluster/${name}`]
    },
    {
      permissions: ['ecs:DescribeTasks'],
      getArns: (name, region, accountId) => [`arn:aws:ecs:${region}:${accountId}:task/${name}/*`]
    },
    {
      permissions: ['ecs:ListClusters', 'ecs:ListTasks', 'ecs:ListTaskDefinitions', 'ecs:DescribeTaskDefinition']
    }
  ],
  [AgentPermission.CloudFormationRead]: [
    {
      permissions: [
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:DescribeStackResources',
        'cloudformation:GetTemplate'
      ],
      getArns: (name, region, accountId) => [`arn:aws:cloudformation:${region}:${accountId}:stack/${name}/*`]
    }
  ]
};

/** AWS service each permission calls, so the egress proxy lets the agent reach its endpoint. */
export const PERMISSION_SERVICES: Record<AgentPermission, string> = {
  [AgentPermission.LogsRead]: 'logs',
  [AgentPermission.LambdaRead]: 'lambda',
  [AgentPermission.EcsRead]: 'ecs',
  [AgentPermission.CloudFormationRead]: 'cloudformation'
};

export const buildPermissionGrants = (
  permissions: Agent.Permissions,
  options: DeployOptions,
  region: string,
  accountId: string
): IdentityGrant[] => {
  const grants: IdentityGrant[] = [];

  // ez4 names every resource `<prefix>-<project>-...`: grants name them without the prefix, which follows the deploy.
  const prefix = toKebabCase(options.prefix);

  for (const { permission, resources } of permissions.grants ?? []) {
    const names = resources.map((resource) => `${prefix}-${resource}`);

    for (const { permissions: actions, getArns } of PERMISSION_POLICIES[permission]) {
      const resourceIds = getArns ? [...new Set(names.flatMap((name) => getArns(name, region, accountId)))] : ['*'];
      grants.push({ resourceIds, permissions: actions });
    }
  }

  for (const { actions, resources } of permissions.statements ?? []) {
    grants.push({ resourceIds: [...resources], permissions: [...actions] });
  }

  return grants;
};
