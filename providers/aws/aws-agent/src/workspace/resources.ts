import type { EntryState, EntryStates } from '@ez4/state';
import type { AgentService } from '@ez4/agent/library';
import type { DeployOptions, IdentityGrant } from '@ez4/project/library';
import type { FileSystemState, AccessPointState } from '@ez4/aws-efs';

import {
  createFileSystem,
  createMountTarget,
  pickSubnetPerZone,
  createAccessPoint,
  createFileSystemStateId,
  createAccessPointStateId,
  createMountTargetStateId
} from '@ez4/aws-efs';
import { MissingAgentNetworkError } from '../network/errors';
import { AgentEfsNetworkTag } from '../network/discovery';
import { getWorkspaceFileSystemName } from '../utils/names';
import { WORKSPACE_MOUNT_PATH } from './runtime';

export { WORKSPACE_MOUNT_PATH };
export { getWorkspaceFileSystemName };
export { AgentEfsNetworkTag };

export const WORKSPACE_VOLUME_NAME = 'workspace';

export type WorkspaceResources = {
  fileSystem: FileSystemState;
  accessPoint: AccessPointState;
};

export const prepareWorkspaceResources = <E extends EntryState>(
  state: EntryStates<E>,
  agents: AgentService[],
  options: DeployOptions,
  network: { subnets: { subnetId: string; availabilityZone: string }[]; efsSecurityGroupIds: string[] }
): WorkspaceResources | undefined => {
  const workspaceAgents = agents.filter((agent) => !!agent.workspace);
  if (!workspaceAgents.length) {
    return undefined;
  }

  if (!network.efsSecurityGroupIds || network.efsSecurityGroupIds.length === 0) {
    throw new MissingAgentNetworkError(
      `no security groups found with tag '${AgentEfsNetworkTag.key}=${AgentEfsNetworkTag.value}'`
    );
  }

  const fileSystemName = getWorkspaceFileSystemName(options);
  const fileSystemStateId = createFileSystemStateId(fileSystemName);
  const fileSystem: FileSystemState =
    (state[fileSystemStateId] as FileSystemState | undefined) ??
    createFileSystem(state, {
      fileSystemName,
      tags: options.tags
    });

  const subnetIds = pickSubnetPerZone(network.subnets);
  for (const subnetId of subnetIds) {
    const mountTargetStateId = createMountTargetStateId(fileSystem.entryId, subnetId);
    if (!state[mountTargetStateId]) {
      createMountTarget(state, fileSystem, {
        subnetId,
        securityGroupIds: network.efsSecurityGroupIds
      });
    }
  }

  const accessPointStateId = createAccessPointStateId(fileSystem.entryId, fileSystemName);
  const accessPoint: AccessPointState =
    (state[accessPointStateId] as AccessPointState | undefined) ??
    createAccessPoint(state, fileSystem, {
      accessPointName: fileSystemName,
      path: '/workspace',
      uid: 1000,
      gid: 1000,
      tags: options.tags
    });

  return { fileSystem, accessPoint };
};

export const buildWorkspaceGrants = (fileSystemArn: string, accessPointArn: string): IdentityGrant[] => {
  return [
    {
      permissions: ['elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite'],
      resourceIds: [fileSystemArn],
      conditions: {
        StringEquals: {
          'elasticfilesystem:AccessPointArn': accessPointArn
        }
      }
    }
  ];
};

export const getWorkspaceDomains = (workspace: NonNullable<AgentService['workspace']>): string[] => {
  const domains = new Set<string>();

  for (const repo of workspace.repos ?? []) {
    if (!repo.url) continue;
    try {
      const parsed = new URL(repo.url);
      if (parsed.hostname) {
        domains.add(parsed.hostname);
        continue;
      }
    } catch {
      // not a standard http(s) URL
    }
    const match = repo.url.match(/^(?:[\w-]+@)?([^/:]+)/);
    if (match?.[1]) {
      domains.add(match[1]);
    }
  }

  if (workspace.auth && 'githubApp' in workspace.auth && workspace.auth.githubApp) {
    domains.add('api.github.com');
  }

  return Array.from(domains).sort();
};
