import type { AgentService } from '@ez4/agent/library';
import type { Agent } from '@ez4/agent';
import type { CredentialPorts } from '../auth/login';
import type { LogGroupState } from '@ez4/aws-logs';
import type { RoleState } from '@ez4/aws-identity';
import type { ConnectResourceEvent, DeployOptions, PrepareResourceEvent } from '@ez4/project/library';
import type { NetworkLookup } from '../network/discovery';
import type { StepContext } from '@ez4/state';
import type { EcrImageState } from '@ez4/aws-ecr';
import type { SecretState } from '@ez4/aws-secret';
import type { AccessPointState, MountTargetState } from '@ez4/aws-efs';
import { AccessPointServiceType, isMountTargetState, createFileSystemStateId, createAccessPointStateId } from '@ez4/aws-efs';
import { prepareWorkspaceResources, type WorkspaceResources, AgentEfsNetworkTag, getWorkspaceFileSystemName } from '../workspace/resources';
import { AgentNetworkTag } from '../network/discovery';
import { isAgentService, isAgentWorkflowService } from '@ez4/agent/library';
import { prepareWorkflowResources } from '../workflow/resources';
import { createBucket, createBucketStateId } from '@ez4/aws-bucket';
import { getAccountId, getRegion, RoleServiceType } from '@ez4/aws-identity';
import { createLogGroup, LogGroupServiceType } from '@ez4/aws-logs';
import { getDefaultVpcId, getTaggedSecurityGroupIds, getTaggedSubnetIds } from '@ez4/aws-vpc';
import { linkEntryConnection } from '@ez4/state';
import { hashData, toKebabCase } from '@ez4/utils';

import { buildAgentBundle } from '../runtime/bundle';
import { createEcsCluster, createEcsClusterStateId, createEcsTaskDefinition } from '@ez4/aws-ecs';
import { createEcrImage, createEcrRepository, EcrImageServiceType } from '@ez4/aws-ecr';
import { computeImageTag, generateDockerfile } from '../image/dockerfile';
import { buildTaskDefinitionInput } from '../agent/taskdef';
import { discoverAgentNetwork } from '../network/discovery';
import { createSecret, createSecretStateId, SecretServiceType } from '@ez4/aws-secret';
import { generateAgentPassword, generateHtpasswd } from '../proxy/auth';
import { createNamespace, createNamespaceStateId } from '@ez4/aws-cloudmap';
import { createProxyService, createProxyServiceStateId } from '../proxy/ecs-service';
import { generateSquidConfig, getAgentEgressDomains } from '../proxy/config';
import { ensureProviderCredential, getDefaultCredentialPorts } from '../auth/login';
import { ProviderAuths } from '../auth/providers';
import { buildAgentExecutionRole } from '../role/execution';
import { buildAgentTaskRole } from '../role/task';
import {
  getAgentBucketName,
  getAgentClusterName,
  getAgentLogGroupName,
  getAgentRepositoryName,
  getAgentsBaseName,
  getAgentsNamespaceName,
  getAgentProxyUrl,
  getAgentProxySecretName,
  getProviderSecretName
} from '../utils/names';
import { buildDispatcherBundle, prepareDispatcher } from '../dispatch/resources';

export type AgentResourcePorts = {
  network: NetworkLookup;
  bundle: (agent: AgentService, options: DeployOptions) => Promise<{ file: string; hash: string }>;
  identity: () => Promise<{ region: string; accountId: string }>;
  dispatcherBundle: () => Promise<string>;
  credential: CredentialPorts;
};

const defaultPorts: AgentResourcePorts = {
  network: { getDefaultVpcId, getTaggedSubnetIds, getTaggedSecurityGroupIds },
  bundle: buildAgentBundle,
  dispatcherBundle: buildDispatcherBundle,
  identity: async () => {
    const [region, accountId] = await Promise.all([getRegion(), getAccountId()]);
    return { region, accountId };
  },
  credential: getDefaultCredentialPorts()
};

export const prepareAgentResources = async (event: PrepareResourceEvent, ports: AgentResourcePorts = defaultPorts): Promise<boolean> => {
  const { state, service, options, context } = event;
  if (isAgentWorkflowService(service)) {
    await prepareWorkflowResources(state, service, context, options, { identity: ports.identity });
    return true;
  }
  if (!isAgentService(service)) return false;
  const { region, accountId } = await ports.identity();
  const network = await discoverAgentNetwork(undefined, ports.network);

  const agents = Object.values(event.metadata).filter(isAgentService);
  // Every agent's credential exists before the proxy service, which mounts all of their hashes.
  const credentials = agents.map((agent) => {
    const secretName = getAgentProxySecretName(agent, options);
    return (
      state[createSecretStateId(secretName)] ??
      createSecret(state, {
        secretName,
        description: `EZ4 egress proxy credentials for agent ${agent.name}`,
        getSecretValue: () => {
          const password = generateAgentPassword();
          return Promise.resolve({
            username: agent.name,
            password,
            htpasswd: generateHtpasswd({ [agent.name]: password }).trim()
          });
        },
        tags: options.tags
      })
    );
  });
  const credential = credentials[agents.findIndex((agent) => agent.name === service.name)];

  const provider = (service.provider ?? 'claude') as Agent.ProviderName;
  const providerAuth = ProviderAuths[provider];
  let providerCredentialEntryId: string | undefined;

  if (providerAuth && !service.secrets?.[providerAuth.envName]) {
    const secretName = getProviderSecretName(provider, options);
    await ensureProviderCredential(provider, secretName, ports.credential, options.tags);
    const providerSecretId = createSecretStateId(secretName);
    const providerCredential =
      state[providerSecretId] ??
      createSecret(state, {
        secretName,
        description: `EZ4 agent provider credentials for ${provider}`,
        retain: true,
        tags: options.tags
      });
    providerCredentialEntryId = providerCredential.entryId;
  }

  const clusterName = getAgentClusterName(options);
  const bucketName = getAgentBucketName(options);
  const cluster = state[createEcsClusterStateId(clusterName)] ?? createEcsCluster(state, { clusterName, tags: options.tags });
  const bucket = state[createBucketStateId(bucketName)] ?? createBucket(state, { bucketName, tags: options.tags });
  const executionRoleName = `${getAgentsBaseName(options)}-execution-role`;
  const executionRoleId = hashData(RoleServiceType, executionRoleName);
  const workspaceSecrets: Record<string, string> = {};
  for (const agent of agents) {
    const auth = agent.workspace?.auth;
    if (auth && 'githubApp' in auth && auth.githubApp) {
      workspaceSecrets['EZ4_WORKSPACE_GITHUB_APP'] = String(auth.githubApp);
    } else if (auth && 'token' in auth && auth.token) {
      workspaceSecrets['EZ4_WORKSPACE_TOKEN'] = String(auth.token);
    }
  }

  let workspaceResources: WorkspaceResources | undefined;
  if (agents.some((agent) => !!agent.workspace)) {
    const efsSecurityGroupIds = ports.network.findSecurityGroupsByTag
      ? await ports.network.findSecurityGroupsByTag(AgentEfsNetworkTag, network.vpcId)
      : ports.network.getTaggedSecurityGroupIds
        ? await ports.network.getTaggedSecurityGroupIds(network.vpcId, AgentEfsNetworkTag)
        : [];

    let subnets: Array<{ subnetId: string; availabilityZone: string }>;
    if (ports.network.findSubnetsByTag) {
      const foundSubnets = await ports.network.findSubnetsByTag(AgentNetworkTag, network.vpcId);
      subnets = foundSubnets.map((s, idx) => ({
        subnetId: s.subnetId,
        availabilityZone: s.availabilityZone ?? `az-${idx}`
      }));
    } else {
      subnets = network.subnetIds.map((subnetId, idx) => ({
        subnetId,
        availabilityZone: `az-${idx}`
      }));
    }

    workspaceResources = prepareWorkspaceResources(state, agents, options, {
      subnets,
      efsSecurityGroupIds: efsSecurityGroupIds ?? []
    });
  }

  const executionSecrets = Object.assign(
    {},
    ...agents.map((agent) => agent.secrets ?? {}),
    service.secrets ?? {},
    workspaceSecrets,
    providerAuth ? { [providerAuth.envName]: getProviderSecretName(provider, options) } : {},
    ...agents.map((agent) => ({
      [`EZ4_PROXY_${toKebabCase(agent.name)}`]: getAgentProxySecretName(agent, options)
    }))
  );
  const executionRole =
    (state[executionRoleId] as RoleState | undefined) ??
    buildAgentExecutionRole(state, { ...service, secrets: executionSecrets }, options, region, accountId);
  const namespaceName = getAgentsNamespaceName(options);
  const namespace =
    state[createNamespaceStateId(namespaceName)] ??
    createNamespace(state, { namespaceName, vpcId: network.vpcId, serviceName: 'proxy', tags: options.tags });
  const proxyServiceName = `${getAgentsBaseName(options)}-proxy`;
  if (!state[createProxyServiceStateId(proxyServiceName)]) {
    const proxyLogGroup = createLogGroup(state, { groupName: proxyServiceName, retention: 30, tags: options.tags });
    createProxyService(
      state,
      {
        serviceName: proxyServiceName,
        baseName: getAgentsBaseName(options),
        clusterName,
        squidConfig: generateSquidConfig({
          agents: agents.map((agent) => ({ agentName: agent.name, allowedDomains: getAgentEgressDomains(agent, region) }))
        }),
        region,
        subnetIds: network.subnetIds,
        securityGroupIds: network.proxySecurityGroupIds,
        tags: options.tags
      },
      [namespace.entryId, proxyLogGroup.entryId, executionRole.entryId, cluster.entryId, ...credentials.map(({ entryId }) => entryId)]
    );
  }
  const linkedAgents = Object.values(service.services ?? {})
    .map(({ reference }) => reference)
    .filter((name) => !!name && isAgentService(event.metadata[name] ?? {}));
  const workspaceArns =
    service.workspace && workspaceResources
      ? {
          fileSystemArn: `arn:aws:elasticfilesystem:${region}:${accountId}:file-system/*`,
          accessPointArn: `arn:aws:elasticfilesystem:${region}:${accountId}:access-point/*`
        }
      : undefined;
  const taskRole = buildAgentTaskRole(state, service, options, accountId, linkedAgents, workspaceArns);
  const logGroup = createLogGroup(state, { groupName: getAgentLogGroupName(service, options), retention: 30, tags: options.tags });
  const dispatcherGroupName = `${getAgentsBaseName(options)}-dispatcher`;
  const dispatcherGroupId = hashData(LogGroupServiceType, dispatcherGroupName);
  const dispatcherLogGroup =
    (state[dispatcherGroupId] as LogGroupState | undefined) ??
    createLogGroup(state, {
      groupName: dispatcherGroupName,
      retention: 30,
      tags: options.tags
    });
  prepareDispatcher(state, options, {
    region,
    accountId,
    bucketName,
    clusterName,
    logGroup: dispatcherLogGroup,
    bundle: ports.dispatcherBundle
  });
  const repository = createEcrRepository(state, {
    repositoryName: getAgentRepositoryName(service, options),
    scanOnPush: true,
    tags: options.tags
  });

  const bundle = await ports.bundle(service, options);
  const dockerfile = generateDockerfile(service);
  const image = createEcrImage(state, repository, {
    imageName: service.name,
    dockerfile,
    bundleFile: bundle.file,
    bundleHash: bundle.hash,
    imageTag: computeImageTag(dockerfile, bundle.hash)
  });

  const workspaceDependencies: string[] = [];
  if (service.workspace && workspaceResources) {
    workspaceDependencies.push(workspaceResources.accessPoint.entryId);
    const fsEntryId = workspaceResources.fileSystem.entryId;
    const mountTargets = Object.values(state).filter(
      (e): e is MountTargetState => !!e && isMountTargetState(e) && e.dependencies.includes(fsEntryId)
    );
    for (const mt of mountTargets) {
      workspaceDependencies.push(mt.entryId);
    }
  }

  const taskdef = createEcsTaskDefinition(
    state,
    [
      image.entryId,
      logGroup.entryId,
      taskRole.entryId,
      executionRole.entryId,
      credential.entryId,
      ...(providerCredentialEntryId ? [providerCredentialEntryId] : []),
      ...workspaceDependencies
    ],
    {
      family: service.name,
      subnetIds: network.subnetIds,
      securityGroupIds: network.securityGroupIds,
      tags: options.tags,
      getTaskDefinition: (stepContext: StepContext) => {
        const imageDep = stepContext.getDependencies<EcrImageState>(EcrImageServiceType).at(0);
        const imageUri = imageDep?.result?.imageUri ?? '';
        const roles = stepContext.getDependencies<RoleState>(RoleServiceType);
        const taskRoleArn = roles.find(({ parameters: roleParams }) => roleParams.roleName.endsWith('-task-role'))?.result?.roleArn ?? '';
        const executionRoleArn =
          roles.find(({ parameters: roleParams }) => roleParams.roleName.endsWith('-execution-role'))?.result?.roleArn ?? '';
        const logDep = stepContext.getDependencies<LogGroupState>(LogGroupServiceType).at(0);
        const logGroupArn = logDep?.result?.groupArn ?? '';
        const allSecrets = stepContext.getDependencies<SecretState>(SecretServiceType);
        const proxyCred = allSecrets.find((s) => s.parameters.secretName === getAgentProxySecretName(service, options));
        const proxySecretArn = proxyCred?.result?.secretArn ?? '';
        const providerSecrets: Array<{ name: string; secretArn: string }> = [];
        if (providerCredentialEntryId && providerAuth) {
          const providerSecretName = getProviderSecretName(provider, options);
          const providerCred = allSecrets.find((s) => s.parameters.secretName === providerSecretName);
          if (providerCred?.result?.secretArn) {
            providerSecrets.push({ name: providerAuth.envName, secretArn: providerCred.result.secretArn });
          }
        }
        const apDep = stepContext.getDependencies<AccessPointState>(AccessPointServiceType).at(0);
        const workspaceEfs = apDep?.result
          ? {
              fileSystemId: apDep.result.fileSystemId,
              accessPointId: apDep.result.accessPointId
            }
          : undefined;
        return buildTaskDefinitionInput(service, imageUri, taskRoleArn, executionRoleArn, logGroupArn, {
          baseName: getAgentsBaseName(options),
          bucketName,
          region,
          proxy: {
            url: getAgentProxyUrl(options),
            secretArn: proxySecretArn
          },
          ...(workspaceEfs ? { workspace: workspaceEfs } : {}),
          ...(providerSecrets.length > 0 ? { providerSecrets } : {})
        });
      }
    }
  );
  linkEntryConnection(state, taskdef.entryId, cluster.entryId);
  linkEntryConnection(state, taskdef.entryId, bucket.entryId);
  if (service.workspace && workspaceResources) {
    linkEntryConnection(state, taskdef.entryId, workspaceResources.fileSystem.entryId);
    linkEntryConnection(state, taskdef.entryId, workspaceResources.accessPoint.entryId);
  }

  context.setServiceState(service, options, taskdef);
  return true;
};

export const connectAgentResources = (event: ConnectResourceEvent): void => {
  const { state, service, options, context } = event;
  if (isAgentWorkflowService(service)) return;
  if (!isAgentService(service)) return;
  const taskdef = context.getServiceState(service, options);
  linkEntryConnection(state, taskdef.entryId, createEcsClusterStateId(getAgentClusterName(options)));
  linkEntryConnection(state, taskdef.entryId, createBucketStateId(getAgentBucketName(options)));
  if (service.workspace) {
    const fileSystemStateId = createFileSystemStateId(getWorkspaceFileSystemName(options));
    if (state[fileSystemStateId]) {
      linkEntryConnection(state, taskdef.entryId, fileSystemStateId);
    }
    const accessPointStateId = createAccessPointStateId(fileSystemStateId, getWorkspaceFileSystemName(options));
    if (state[accessPointStateId]) {
      linkEntryConnection(state, taskdef.entryId, accessPointStateId);
    }
  }
};
