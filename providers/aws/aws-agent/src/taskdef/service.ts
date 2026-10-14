import type { EntryState, EntryStates } from '@ez4/state';
import type { AgentRuntimeFields } from './types';
import type { RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';
import type { EcsTaskDefParameters, EcsTaskDefState } from './types';

import { attachEntry } from '@ez4/state';
import { hashData, toKebabCase } from '@ez4/utils';
import { EcsTaskDefServiceType } from './types';

export interface TaskDefOptions {
  baseName: string;
  bucketName: string;
  noProxy?: string;
  region?: string;
}

export const createEcsTaskDefStateId = (agentName: string) => {
  return hashData(EcsTaskDefServiceType, toKebabCase(agentName));
};

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
  // arn:aws:iam::<account>:role/...
  // arn:aws:logs:<region>:<account>:log-group:...
  let region = options.region ?? 'us-east-1';
  let accountId = '';

  const logParts = logGroupArn.split(':');
  if (logParts.length >= 6) {
    if (logParts[3]) {
      region = logParts[3];
    }
    if (logParts[4]) {
      accountId = logParts[4];
    }
  }

  if (!accountId) {
    const roleParts = taskRoleArn.split(':');
    if (roleParts.length >= 5 && roleParts[4]) {
      accountId = roleParts[4];
    }
  }

  const secrets = Object.entries(agent.secrets ?? {}).map(([name, secretRef]) => {
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

  const logGroupName = logGroupArn.includes(':log-group:') ? logGroupArn.split(':log-group:')[1] : logGroupArn;

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
        name: 'agent',
        image: imageUri,
        user: '1000',
        essential: true,
        privileged: false,
        linuxParameters: {
          capabilities: {
            drop: ['ALL']
          }
        },
        environment: [
          { name: 'EZ4_AGENT_NAME', value: agent.name },
          { name: 'EZ4_AGENT_BUCKET', value: options.bucketName },
          { name: 'EZ4_AGENT_TIMEOUT', value: String(timeout) },
          { name: 'NO_PROXY', value: options.noProxy ?? '169.254.169.254' }
        ],
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

export const createEcsTaskDefinition = <E extends EntryState>(
  state: EntryStates<E>,
  parameters: EcsTaskDefParameters,
  dependencies: string[] = []
): EcsTaskDefState => {
  const entryId = createEcsTaskDefStateId(parameters.agentName);

  return attachEntry<E | EcsTaskDefState, EcsTaskDefState>(state, {
    type: EcsTaskDefServiceType,
    entryId,
    dependencies,
    parameters
  });
};
