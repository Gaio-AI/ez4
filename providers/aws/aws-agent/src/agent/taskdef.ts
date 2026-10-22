import { AgentPermission } from '@ez4/agent';
import { REGISTRY_GRANTS_ENV, type RegistryGrant } from '../runtime/registry';
import type { MountPoint, RegisterTaskDefinitionCommandInput, Volume } from '@aws-sdk/client-ecs';
import type { AgentService } from '@ez4/agent/library';
import type { LinkedVariables } from '@ez4/project/library';
import type { StepContext } from '@ez4/state';
import { buildEfsVolume } from '@ez4/aws-ecs';
import { AccessPointServiceType } from '@ez4/aws-efs';
import { toKebabCase } from '@ez4/utils';
import { buildNoProxyList } from '../proxy/config';
import { WORKSPACE_MOUNT_PATH, WORKSPACE_VOLUME_NAME } from '../workspace/resources';

export const AGENT_CONTAINER_NAME = 'agent';

export type AgentRuntimeFields = Pick<AgentService, 'name' | 'resources' | 'secrets' | 'workspace' | 'permissions'>;

export interface TaskDefOptions {
  baseName: string;
  bucketName: string;
  noProxy?: string;
  region?: string;
  proxy?: { url: string; secretArn: string };
  providerSecrets?: Array<{ name: string; secretArn: string }>;
  /** Secret ez4 manages with the workspace's GitHub App credentials. */
  workspaceSecretArn?: string;
  workspace?: { fileSystemId: string; accessPointId: string };
  variables?: LinkedVariables;
}

export const buildTaskDefinitionInput = (
  agent: AgentRuntimeFields,
  imageUri: string,
  taskRoleArn: string,
  executionRoleArn: string,
  logGroupArn: string,
  options: TaskDefOptions
): RegisterTaskDefinitionCommandInput => {
  const cpu = String(agent.resources?.cpu ?? 1024);
  const memory = String(agent.resources?.memory ?? 2048);
  const storage = agent.resources?.storage ?? 21;
  const timeout = agent.resources?.timeout ?? 3600;

  // Derive region and account from taskRoleArn or executionRoleArn or options
  let region = options.region ?? 'us-east-1';
  let accountId = '';

  const logParts = logGroupArn.split(':');
  if (logParts.length >= 6) {
    region = logParts[3] || region;
    accountId = logParts[4] || accountId;
  }

  if (!accountId) {
    const roleParts = taskRoleArn.split(':');
    if (roleParts.length >= 5 && roleParts[4]) {
      accountId = roleParts[4];
    }
  }

  const secrets = Object.entries(agent.secrets ?? {}).map(([name, value]) => {
    const secretRef = String(value);
    if (secretRef.startsWith('arn:')) {
      return { name, valueFrom: secretRef };
    }
    // Check if secretRef contains :jsonKey (e.g. 'stg/github-app:private_key')
    if (secretRef.includes(':')) {
      const [secretName, jsonKey] = secretRef.split(':');
      const arn = `arn:aws:secretsmanager:${region}:${accountId}:secret:${secretName}:${jsonKey}::`;
      return { name, valueFrom: arn };
    }
    const arn = `arn:aws:secretsmanager:${region}:${accountId}:secret:${secretRef}`;
    return { name, valueFrom: arn };
  });

  if (options.providerSecrets) {
    for (const { name, secretArn } of options.providerSecrets) {
      if (!agent.secrets?.[name]) {
        secrets.push({
          name,
          valueFrom: `${secretArn}:${name}::`
        });
      }
    }
  }

  if (options.proxy) {
    secrets.push({
      name: 'EZ4_AGENT_PROXY_PASSWORD',
      valueFrom: `${options.proxy.secretArn}:password::`
    });
  }

  if (agent.workspace?.auth) {
    const auth = agent.workspace.auth;
    if ('githubApp' in auth) {
      if (options.workspaceSecretArn) {
        secrets.push({ name: 'EZ4_WORKSPACE_GITHUB_APP', valueFrom: options.workspaceSecretArn });
      }
    } else if ('token' in auth && auth.token) {
      const secretRef = String(auth.token);
      const arn = secretRef.startsWith('arn:')
        ? secretRef
        : secretRef.includes(':')
          ? `arn:aws:secretsmanager:${region}:${accountId}:secret:${secretRef.split(':')[0]}:${secretRef.split(':')[1]}::`
          : `arn:aws:secretsmanager:${region}:${accountId}:secret:${secretRef}`;
      if (!secrets.some((s) => s.name === 'EZ4_WORKSPACE_TOKEN')) {
        secrets.push({ name: 'EZ4_WORKSPACE_TOKEN', valueFrom: arn });
      }
    }
  }

  const logGroupName = logGroupArn.includes(':log-group:') ? logGroupArn.split(':log-group:')[1] : logGroupArn;

  const environment = [
    ...Object.entries(options.variables ?? {}).map(([name, value]) => ({ name, value })),
    { name: 'EZ4_AGENT_NAME', value: agent.name },
    { name: 'EZ4_AGENT_BUCKET', value: options.bucketName },
    { name: 'EZ4_AGENT_TIMEOUT', value: String(timeout) },
    { name: 'NO_PROXY', value: options.noProxy ?? buildNoProxyList(region).join(',') }
  ];

  if (options.proxy) {
    environment.push({ name: 'EZ4_AGENT_PROXY_URL', value: options.proxy.url });
  }

  if (agent.workspace) {
    // Only the repositories: the credentials reach the container as secrets.
    environment.push({
      name: 'EZ4_AGENT_WORKSPACE',
      value: JSON.stringify({ repos: agent.workspace.repos })
    });
  }

  const registryGrants: RegistryGrant[] = (agent.permissions?.grants ?? [])
    .filter(({ permission }) => permission === AgentPermission.CodeArtifactRead)
    .flatMap(({ resources }) =>
      resources.map((resource) => {
        const [domain, repository] = resource.split('/');
        return { domain: domain!, repository: repository!, region, accountId };
      })
    );

  if (registryGrants.length > 0) {
    environment.push({ name: REGISTRY_GRANTS_ENV, value: JSON.stringify(registryGrants) });
  }

  const volumes: Volume[] = [];
  const mountPoints: MountPoint[] = [];

  if (agent.workspace && options.workspace) {
    volumes.push(buildEfsVolume(WORKSPACE_VOLUME_NAME, options.workspace.fileSystemId, options.workspace.accessPointId));
    mountPoints.push({
      sourceVolume: WORKSPACE_VOLUME_NAME,
      containerPath: WORKSPACE_MOUNT_PATH,
      readOnly: false
    });
  }
  return {
    family: `${options.baseName}-${toKebabCase(agent.name)}`,
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu,
    memory,
    taskRoleArn,
    executionRoleArn,
    ephemeralStorage: {
      sizeInGiB: storage
    },
    containerDefinitions: [
      {
        name: AGENT_CONTAINER_NAME,
        image: imageUri,
        user: '1000',
        essential: true,
        privileged: false,
        linuxParameters: {
          capabilities: {
            drop: ['ALL']
          }
        },
        environment,
        secrets: secrets.length > 0 ? secrets : undefined,
        mountPoints: mountPoints.length > 0 ? mountPoints : undefined,
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': logGroupName,
            'awslogs-region': region,
            'awslogs-stream-prefix': 'agent'
          }
        }
      }
    ],
    volumes: volumes.length > 0 ? volumes : undefined
  };
};

export const buildAgentTaskDefinition = (
  agent: AgentRuntimeFields,
  imageUriOrContext: string | StepContext | { fileSystemId: string; accessPointId: string } | unknown,
  taskRoleArn?: string,
  executionRoleArn?: string,
  logGroupArn?: string,
  options?: TaskDefOptions
): RegisterTaskDefinitionCommandInput => {
  let workspaceEfs: { fileSystemId: string; accessPointId: string } | undefined;
  if (typeof imageUriOrContext === 'object' && imageUriOrContext !== null) {
    const ctx = imageUriOrContext as Record<string, unknown>;
    if (typeof ctx.getDependencies === 'function') {
      const apDeps = (ctx.getDependencies as (type: string) => unknown[])(AccessPointServiceType);
      const ap = apDeps?.[0] as { result?: { fileSystemId: string; accessPointId: string } } | undefined;
      if (ap?.result?.fileSystemId && ap?.result?.accessPointId) {
        workspaceEfs = {
          fileSystemId: ap.result.fileSystemId,
          accessPointId: ap.result.accessPointId
        };
      }
    }
    if (!workspaceEfs && typeof ctx.fileSystemId === 'string' && typeof ctx.accessPointId === 'string') {
      workspaceEfs = {
        fileSystemId: ctx.fileSystemId,
        accessPointId: ctx.accessPointId
      };
    }
  }

  const effectiveOptions: TaskDefOptions = {
    baseName: options?.baseName ?? toKebabCase(agent.name),
    bucketName: options?.bucketName ?? '',
    ...options,
    ...(workspaceEfs || options?.workspace ? { workspace: options?.workspace ?? workspaceEfs } : {})
  };

  if (typeof imageUriOrContext === 'string' && taskRoleArn && executionRoleArn && logGroupArn && options) {
    return buildTaskDefinitionInput(agent, imageUriOrContext, taskRoleArn, executionRoleArn, logGroupArn, effectiveOptions);
  }
  return buildTaskDefinitionInput(
    agent,
    typeof imageUriOrContext === 'string' ? imageUriOrContext : '',
    taskRoleArn ?? '',
    executionRoleArn ?? '',
    logGroupArn ?? '',
    effectiveOptions
  );
};
