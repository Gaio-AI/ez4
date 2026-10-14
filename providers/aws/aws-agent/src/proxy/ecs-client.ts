import type { OperationLogLine } from '@ez4/aws-common';
import type { CreateServiceCommandInput, RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';
import type { ProxyServiceParameters, ProxyServiceResult } from './ecs-types';

import {
  CreateServiceCommand,
  DeleteServiceCommand,
  DescribeServicesCommand,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand
} from '@aws-sdk/client-ecs';

import { getEcsClient, getEcsTagList } from '../cluster/client';

export const buildCreateServiceInput = (
  parameters: ProxyServiceParameters,
  taskDefinitionArn: string,
  registryArn: string
): CreateServiceCommandInput => ({
  cluster: parameters.clusterName,
  serviceName: parameters.serviceName,
  taskDefinition: taskDefinitionArn,
  desiredCount: 1,
  launchType: 'FARGATE',
  networkConfiguration: {
    awsvpcConfiguration: {
      subnets: parameters.subnetIds,
      securityGroups: parameters.securityGroupIds,
      assignPublicIp: 'DISABLED'
    }
  },
  serviceRegistries: [{ registryArn }],
  propagateTags: 'SERVICE',
  tags: parameters.tags ? getEcsTagList(parameters.tags) : undefined
});

export const upsertProxyService = async (
  logger: OperationLogLine,
  parameters: ProxyServiceParameters,
  taskDefinitionInput: RegisterTaskDefinitionCommandInput,
  registryArn: string
): Promise<ProxyServiceResult> => {
  logger.update('Registering proxy task definition');

  const taskDefResponse = await getEcsClient().send(
    new RegisterTaskDefinitionCommand(taskDefinitionInput)
  );

  const taskDefinitionArn = taskDefResponse.taskDefinition?.taskDefinitionArn;
  if (!taskDefinitionArn) {
    throw new Error(`Failed to register proxy task definition for ${parameters.serviceName}`);
  }

  logger.update('Checking ECS proxy service');

  const describeResponse = await getEcsClient().send(
    new DescribeServicesCommand({
      cluster: parameters.clusterName,
      services: [parameters.serviceName]
    })
  );

  const activeService = describeResponse.services?.find(
    (s) => s.serviceName === parameters.serviceName && s.status === 'ACTIVE'
  );

  let serviceArn: string;

  if (activeService) {
    logger.update('Updating ECS proxy service');

    const updateResponse = await getEcsClient().send(
      new UpdateServiceCommand({
        cluster: parameters.clusterName,
        service: parameters.serviceName,
        taskDefinition: taskDefinitionArn,
        desiredCount: 1
      })
    );

    if (!updateResponse.service?.serviceArn) {
      throw new Error(`Failed to update ECS proxy service ${parameters.serviceName}`);
    }

    serviceArn = updateResponse.service.serviceArn;
  } else {
    logger.update('Creating ECS proxy service');

    const createResponse = await getEcsClient().send(
      new CreateServiceCommand(
        buildCreateServiceInput(parameters, taskDefinitionArn, registryArn)
      )
    );

    if (!createResponse.service?.serviceArn) {
      throw new Error(`Failed to create ECS proxy service ${parameters.serviceName}`);
    }

    serviceArn = createResponse.service.serviceArn;
  }

  return {
    serviceArn,
    taskDefinitionArn
  };
};

export const deleteProxyService = async (
  logger: OperationLogLine,
  parameters: ProxyServiceParameters
): Promise<void> => {
  logger.update('Deleting ECS proxy service');

  try {
    await getEcsClient().send(
      new UpdateServiceCommand({
        cluster: parameters.clusterName,
        service: parameters.serviceName,
        desiredCount: 0
      })
    );
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : undefined;
    if (name !== 'ServiceNotFoundException' && name !== 'ServiceNotActiveException') {
      throw error;
    }
  }

  try {
    await getEcsClient().send(
      new DeleteServiceCommand({
        cluster: parameters.clusterName,
        service: parameters.serviceName,
        force: true
      })
    );
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : undefined;
    if (name !== 'ServiceNotFoundException' && name !== 'ServiceNotActiveException') {
      throw error;
    }
  }
};
