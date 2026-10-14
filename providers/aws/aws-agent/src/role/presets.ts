import type { Agent } from '@ez4/agent';
import type { IdentityGrant } from '@ez4/project/library';

export const PRESET_POLICIES: Record<Agent.Preset, IdentityGrant> = {
  'logs-read': {
    resourceIds: ['*'],
    permissions: [
      'logs:DescribeLogGroups',
      'logs:DescribeLogStreams',
      'logs:GetLogEvents',
      'logs:FilterLogEvents'
    ]
  },
  'lambda-read': {
    resourceIds: ['*'],
    permissions: [
      'lambda:GetFunction',
      'lambda:GetFunctionUrlConfig',
      'lambda:GetPolicy',
      'lambda:GetAlias',
      'lambda:ListAliases',
      'lambda:ListVersionsByFunction',
      'lambda:ListFunctionUrlConfigs',
      'lambda:ListEventSourceMappings'
    ]
  },
  'ecs-read': {
    resourceIds: ['*'],
    permissions: [
      'ecs:DescribeClusters',
      'ecs:DescribeTasks',
      'ecs:DescribeTaskDefinition',
      'ecs:ListClusters',
      'ecs:ListTasks',
      'ecs:ListTaskDefinitions'
    ]
  },
  'cloudformation-read': {
    resourceIds: ['*'],
    permissions: [
      'cloudformation:DescribeStacks',
      'cloudformation:DescribeStackEvents',
      'cloudformation:DescribeStackResources',
      'cloudformation:GetTemplate'
    ]
  }
};
