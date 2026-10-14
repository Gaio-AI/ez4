import type { AgentService } from '@ez4/agent/library';
import type { RoleState } from '@ez4/aws-identity';
import type { ConnectResourceEvent, DeployOptions, PrepareResourceEvent } from '@ez4/project/library';
import type { NetworkLookup } from '../network/discovery';

import { isAgentService } from '@ez4/agent/library';
import { createBucket, createBucketStateId } from '@ez4/aws-bucket';
import { getAccountId, getRegion, RoleServiceType } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';
import { getDefaultVpcId, getTaggedSecurityGroupIds, getTaggedSubnetIds } from '@ez4/aws-vpc';
import { linkEntryConnection } from '@ez4/state';
import { hashData } from '@ez4/utils';

import { buildAgentBundle } from '../runtime/bundle';
import { createEcsCluster, createEcsClusterStateId } from '../cluster/service';
import { createAgentImage } from '../image/state';
import { createEcrRepository } from '../image/service';
import { computeImageTag, generateDockerfile } from '../image/dockerfile';
import { discoverAgentNetwork } from '../network/discovery';
import { buildAgentExecutionRole } from '../role/execution';
import { buildAgentTaskRole } from '../role/task';
import { createEcsTaskDefinition } from '../taskdef/service';
import { getAgentBucketName, getAgentClusterName, getAgentLogGroupName, getAgentRepositoryName, getAgentsBaseName } from '../utils/names';

export type AgentResourcePorts = {
  network: NetworkLookup;
  bundle: (agent: AgentService, options: DeployOptions) => Promise<{ file: string; hash: string }>;
  identity: () => Promise<{ region: string; accountId: string }>;
};

const defaultPorts: AgentResourcePorts = {
  network: { getDefaultVpcId, getTaggedSubnetIds, getTaggedSecurityGroupIds },
  bundle: buildAgentBundle,
  identity: async () => {
    const [region, accountId] = await Promise.all([getRegion(), getAccountId()]);
    return { region, accountId };
  }
};

export const prepareAgentResources = async (event: PrepareResourceEvent, ports: AgentResourcePorts = defaultPorts): Promise<boolean> => {
  const { state, service, options, context } = event;
  if (!isAgentService(service)) return false;

  const { region, accountId } = await ports.identity();
  const clusterName = getAgentClusterName(options);
  const bucketName = getAgentBucketName(options);
  const cluster = state[createEcsClusterStateId(clusterName)] ?? createEcsCluster(state, { clusterName, tags: options.tags });
  const bucket = state[createBucketStateId(bucketName)] ?? createBucket(state, { bucketName, tags: options.tags });
  const executionRoleName = `${getAgentsBaseName(options)}-execution-role`;
  const executionRoleId = hashData(RoleServiceType, executionRoleName);
  const executionSecrets = Object.assign(
    {},
    ...Object.values(event.metadata)
      .filter(isAgentService)
      .map((agent) => agent.secrets ?? {}),
    service.secrets ?? {}
  );
  const executionRole =
    (state[executionRoleId] as RoleState | undefined) ??
    buildAgentExecutionRole(state, { ...service, secrets: executionSecrets }, options, region, accountId);

  const linkedAgents = Object.values(service.services ?? {})
    .map(({ reference }) => reference)
    .filter((name) => !!name && isAgentService(event.metadata[name] ?? {}));
  const taskRole = buildAgentTaskRole(state, service, options, accountId, linkedAgents);
  const logGroup = createLogGroup(state, { groupName: getAgentLogGroupName(service, options), retention: 30, tags: options.tags });
  const repository = createEcrRepository(state, {
    repositoryName: getAgentRepositoryName(service, options),
    scanOnPush: true,
    tags: options.tags
  });

  const bundle = await ports.bundle(service, options);
  const dockerfile = generateDockerfile(service);
  const image = createAgentImage(state, repository, {
    agentName: service.name,
    dockerfile,
    bundleFile: bundle.file,
    bundleHash: bundle.hash,
    imageTag: computeImageTag(dockerfile, bundle.hash)
  });

  const network = await discoverAgentNetwork(undefined, ports.network);
  const taskdef = createEcsTaskDefinition(
    state,
    {
      agentName: service.name,
      baseName: getAgentsBaseName(options),
      agent: { name: service.name, resources: service.resources, secrets: service.secrets },
      bucketName,
      region,
      subnetIds: network.subnetIds,
      securityGroupIds: network.securityGroupIds,
      tags: options.tags
    },
    [image.entryId, logGroup.entryId, taskRole.entryId, executionRole.entryId]
  );
  linkEntryConnection(state, taskdef.entryId, cluster.entryId);
  linkEntryConnection(state, taskdef.entryId, bucket.entryId);

  context.setServiceState(service, options, taskdef);
  return true;
};

export const connectAgentResources = (event: ConnectResourceEvent): void => {
  const { state, service, options, context } = event;
  if (!isAgentService(service)) return;
  const taskdef = context.getServiceState(service, options);
  linkEntryConnection(state, taskdef.entryId, createEcsClusterStateId(getAgentClusterName(options)));
  linkEntryConnection(state, taskdef.entryId, createBucketStateId(getAgentBucketName(options)));
};
