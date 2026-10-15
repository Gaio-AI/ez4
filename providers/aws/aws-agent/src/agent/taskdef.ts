import type { RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';
import type { AgentService } from '@ez4/agent/library';
import type { StepContext } from '@ez4/state';
import { toKebabCase } from '@ez4/utils';
import { buildNoProxyList } from '../proxy/config';

export const AGENT_CONTAINER_NAME = 'agent';

export type AgentRuntimeFields = Pick<AgentService, 'name' | 'resources' | 'secrets'>;

export interface TaskDefOptions {
  baseName: string;
  bucketName: string;
  noProxy?: string;
  region?: string;
  proxy?: { url: string; secretArn: string };
  providerSecrets?: Array<{ name: string; secretArn: string }>;
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

  const logGroupName = logGroupArn.includes(':log-group:') ? logGroupArn.split(':log-group:')[1] : logGroupArn;

  const environment = [
    { name: 'EZ4_AGENT_NAME', value: agent.name },
    { name: 'EZ4_AGENT_BUCKET', value: options.bucketName },
    { name: 'EZ4_AGENT_TIMEOUT', value: String(timeout) },
    { name: 'NO_PROXY', value: options.noProxy ?? buildNoProxyList(region).join(',') }
  ];

  if (options.proxy) {
    environment.push({ name: 'EZ4_AGENT_PROXY_URL', value: options.proxy.url });
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
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': logGroupName,
            'awslogs-region': region,
            'awslogs-stream-prefix': 'agent'
          }
        }
      }
    ]
  };
};

export const buildAgentTaskDefinition = (
  agent: AgentRuntimeFields,
  imageUriOrContext: string | StepContext,
  taskRoleArn?: string,
  executionRoleArn?: string,
  logGroupArn?: string,
  options?: TaskDefOptions
): RegisterTaskDefinitionCommandInput => {
  if (typeof imageUriOrContext === 'string' && taskRoleArn && executionRoleArn && logGroupArn && options) {
    return buildTaskDefinitionInput(agent, imageUriOrContext, taskRoleArn, executionRoleArn, logGroupArn, options);
  }
  return buildTaskDefinitionInput(
    agent,
    typeof imageUriOrContext === 'string' ? imageUriOrContext : '',
    taskRoleArn ?? '',
    executionRoleArn ?? '',
    logGroupArn ?? '',
    options ?? { baseName: toKebabCase(agent.name), bucketName: '' }
  );
};
