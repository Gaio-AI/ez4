import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions } from '@ez4/project/library';
import type { EntryStates, StepContext } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual, equal, ok, throws } from 'node:assert/strict';

import { createAgentService } from '@ez4/agent/library';
import { buildEfsVolume } from '@ez4/aws-ecs';
import { AccessPointServiceType, FileSystemServiceType, MountTargetServiceType } from '@ez4/aws-efs';
import {
  prepareWorkspaceResources,
  buildWorkspaceGrants,
  getWorkspaceDomains,
  WORKSPACE_MOUNT_PATH,
  WORKSPACE_VOLUME_NAME,
  getWorkspaceFileSystemName,
  AgentEfsNetworkTag
} from '../src/workspace/resources';
import { buildAgentTaskDefinition } from '../src/agent/taskdef';
import { MissingAgentNetworkError } from '../src/network/errors';

describe('agent workspace resources', () => {
  const options: DeployOptions = {
    prefix: 'ez4',
    projectName: 'test',
    branchName: 'stg',
    lockId: 'test-lock'
  };

  const basicAgent = {
    ...createAgentService('BasicAgent'),
    provider: 'claude',
    model: 'claude-3-5-sonnet',
    instructions: 'basic instructions'
  } as AgentService;

  const workspaceAgent = {
    ...createAgentService('WorkspaceAgent'),
    provider: 'claude',
    model: 'claude-3-5-sonnet',
    instructions: 'workspace instructions',
    workspace: {
      repos: [{ url: 'https://github.com/acme/api.git', name: 'api', branch: 'main' }],
      auth: { githubApp: { appId: '1', installationId: '2', privateKey: 'app-private-key' } }
    }
  } as AgentService;

  const otherWorkspaceAgent = {
    ...createAgentService('OtherWorkspaceAgent'),
    provider: 'claude',
    model: 'claude-3-5-sonnet',
    instructions: 'other workspace instructions',
    workspace: {
      repos: [{ url: 'https://github.com/acme/web.git', name: 'web', branch: 'main' }]
    }
  } as AgentService;

  const network = {
    subnets: [
      { subnetId: 's-1', availabilityZone: 'a' },
      { subnetId: 's-2', availabilityZone: 'b' }
    ],
    efsSecurityGroupIds: ['sg-efs']
  };

  const fakeContext = (efs: { fileSystemId: string; accessPointId: string }) =>
    ({
      fileSystemId: efs.fileSystemId,
      accessPointId: efs.accessPointId,
      getDependencies: (type?: string) => {
        if (type === AccessPointServiceType) {
          return [{ type: AccessPointServiceType, result: efs }];
        }
        if (type === FileSystemServiceType) {
          return [{ type: FileSystemServiceType, result: { fileSystemId: efs.fileSystemId } }];
        }
        return [];
      }
    }) as unknown as StepContext;

  it('assert :: exports constants and names correctly', () => {
    equal(WORKSPACE_MOUNT_PATH, '/mnt/ez4-workspace');
    equal(WORKSPACE_VOLUME_NAME, 'workspace');
    equal(getWorkspaceFileSystemName(options), 'ez4-test-stg-agents-workspace');
    deepEqual(AgentEfsNetworkTag, { key: 'ez4:agents-efs', value: 'true' });
  });

  it('assert :: no workspace agent means no file system', () => {
    const state: EntryStates = {};
    deepEqual(prepareWorkspaceResources(state, [basicAgent], options, network), undefined);
    deepEqual(Object.values(state).filter((e): e is NonNullable<typeof e> => e?.type === FileSystemServiceType).length, 0);
  });

  it('assert :: one file system, one mount target per zone, one access point', () => {
    const state: EntryStates = {};
    prepareWorkspaceResources(state, [workspaceAgent, otherWorkspaceAgent], options, {
      subnets: [
        { subnetId: 's-1', availabilityZone: 'a' },
        { subnetId: 's-2', availabilityZone: 'b' }
      ],
      efsSecurityGroupIds: ['sg-efs']
    });
    const types = Object.values(state)
      .map((e) => e?.type)
      .filter((t): t is string => !!t)
      .sort();
    deepEqual(types, [AccessPointServiceType, FileSystemServiceType, MountTargetServiceType, MountTargetServiceType]);
  });

  it('assert :: throws MissingAgentNetworkError when workspace agent declared but no efs security group', () => {
    const state: EntryStates = {};
    throws(
      () =>
        prepareWorkspaceResources(state, [workspaceAgent], options, {
          subnets: [{ subnetId: 's-1', availabilityZone: 'a' }],
          efsSecurityGroupIds: []
        }),
      (error: unknown) => {
        ok(error instanceof MissingAgentNetworkError);
        ok(error.message.includes('ez4:agents-efs'));
        return true;
      }
    );
  });

  it('assert :: workspace grants are scoped to the access point', () => {
    deepEqual(buildWorkspaceGrants('arn:fs', 'arn:ap'), [
      {
        permissions: ['elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite'],
        resourceIds: ['arn:fs'],
        conditions: { StringEquals: { 'elasticfilesystem:AccessPointArn': 'arn:ap' } }
      }
    ]);
  });

  it('assert :: repo hosts and api.github.com join the egress allowlist', () => {
    deepEqual(
      getWorkspaceDomains({
        repos: [{ url: 'https://github.com/acme/api.git', name: 'api', branch: 'main' }],
        auth: { githubApp: { appId: '1', installationId: '2', privateKey: 'app-private-key' } }
      }),
      ['api.github.com', 'github.com']
    );
  });

  it('assert :: task definition mounts the workspace volume', () => {
    const input = buildAgentTaskDefinition(workspaceAgent, fakeContext({ fileSystemId: 'fs-1', accessPointId: 'fsap-1' }));
    deepEqual(input.volumes, [buildEfsVolume('workspace', 'fs-1', 'fsap-1')]);
    deepEqual(input.containerDefinitions?.[0].mountPoints, [
      { sourceVolume: 'workspace', containerPath: '/mnt/ez4-workspace', readOnly: false }
    ]);
    const env = input.containerDefinitions?.[0].environment ?? [];
    equal(env.find((e) => e.name === 'EZ4_AGENT_WORKSPACE')?.value, JSON.stringify({ repos: workspaceAgent.workspace!.repos }));
  });

  it('assert :: GitHub App credentials reach the task only through the managed secret', () => {
    const input = buildAgentTaskDefinition(
      workspaceAgent,
      fakeContext({ fileSystemId: 'fs-1', accessPointId: 'fsap-1' }),
      undefined,
      undefined,
      undefined,
      {
        baseName: 'ez4-test-stg-agents',
        bucketName: 'bucket',
        workspaceSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:ez4-test-stg-agents-workspace-agent-workspace-AbCdEf'
      }
    );
    const container = input.containerDefinitions?.[0];
    deepEqual(
      container?.secrets?.find((secret) => secret.name === 'EZ4_WORKSPACE_GITHUB_APP')?.valueFrom,
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:ez4-test-stg-agents-workspace-agent-workspace-AbCdEf'
    );
    ok(!JSON.stringify(input).includes('app-private-key'));
  });
});
