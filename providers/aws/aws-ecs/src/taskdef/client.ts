import type { OperationLogLine } from '@ez4/aws-common';
import type { RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';
import type { ResourceTags } from '@ez4/aws-common';
import type { EcsTaskDefResult } from './types';

import { RegisterTaskDefinitionCommand, DeregisterTaskDefinitionCommand, DescribeTaskDefinitionCommand } from '@aws-sdk/client-ecs';

import { getEcsClient, getEcsTagList } from '../cluster/client';

export const registerTaskDefinition = async (
  logger: OperationLogLine,
  parameters: { family: string; taskDefinition: RegisterTaskDefinitionCommandInput; tags?: ResourceTags }
): Promise<Omit<EcsTaskDefResult, 'subnetIds' | 'securityGroupIds'>> => {
  logger.update('Registering ECS task definition');

  const { taskDefinition, tags } = parameters;

  const input: RegisterTaskDefinitionCommandInput = {
    ...taskDefinition,
    tags: tags ? getEcsTagList(tags) : undefined
  };

  const response = await getEcsClient().send(new RegisterTaskDefinitionCommand(input));

  const def = response.taskDefinition;

  if (!def?.taskDefinitionArn || !def?.family || def.revision === undefined) {
    throw new Error(`Failed to register task definition for ${parameters.family}`);
  }

  return {
    taskDefinitionArn: def.taskDefinitionArn,
    family: def.family,
    revision: def.revision
  };
};

export const deregisterTaskDefinition = async (logger: OperationLogLine, taskDefinitionArn: string): Promise<void> => {
  logger.update('Deregistering ECS task definition');

  try {
    await getEcsClient().send(
      new DeregisterTaskDefinitionCommand({
        taskDefinition: taskDefinitionArn
      })
    );
  } catch (error: unknown) {
    logger.update(`Deregister error (ignored): ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const describeTaskDefinition = async (
  logger: OperationLogLine,
  taskDefinitionArn: string
): Promise<Omit<EcsTaskDefResult, 'subnetIds' | 'securityGroupIds'> | null> => {
  logger.update('Describing ECS task definition');

  try {
    const response = await getEcsClient().send(
      new DescribeTaskDefinitionCommand({
        taskDefinition: taskDefinitionArn
      })
    );

    const def = response.taskDefinition;

    if (def?.taskDefinitionArn && def.family && def.revision !== undefined) {
      return {
        taskDefinitionArn: def.taskDefinitionArn,
        family: def.family,
        revision: def.revision
      };
    }

    return null;
  } catch {
    return null;
  }
};
