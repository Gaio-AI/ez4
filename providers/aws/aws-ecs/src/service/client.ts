import type { OperationLogLine } from '@ez4/aws-common';
import type { CreateServiceCommandInput, RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';
import type { EcsServiceParameters, EcsServiceResult } from './types';
import {
  CreateServiceCommand,
  DeleteServiceCommand,
  DescribeServicesCommand,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand,
  waitUntilServicesInactive
} from '@aws-sdk/client-ecs';
import { getAwsClientWaiter } from '@ez4/aws-common';
import { getEcsClient, getEcsTagList } from '../cluster/client';

export const buildCreateServiceInput = (
  parameters: EcsServiceParameters,
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

export const upsertEcsService = async (
  logger: OperationLogLine,
  parameters: EcsServiceParameters,
  taskDefinitionInput: RegisterTaskDefinitionCommandInput,
  registryArn: string
): Promise<EcsServiceResult> => {
  logger.update('Registering ECS service task definition');
  const taskDefResponse = await getEcsClient().send(new RegisterTaskDefinitionCommand(taskDefinitionInput));
  const taskDefinitionArn = taskDefResponse.taskDefinition?.taskDefinitionArn;
  if (!taskDefinitionArn) throw new Error(`Failed to register task definition for ${parameters.serviceName}`);

  logger.update('Checking ECS service');
  const describeResponse = await getEcsClient().send(
    new DescribeServicesCommand({ cluster: parameters.clusterName, services: [parameters.serviceName] })
  );
  const activeService = describeResponse.services?.find(
    (service) => service.serviceName === parameters.serviceName && service.status === 'ACTIVE'
  );
  let serviceArn: string | undefined;
  if (activeService) {
    logger.update('Updating ECS service');
    const response = await getEcsClient().send(
      new UpdateServiceCommand({
        cluster: parameters.clusterName,
        service: parameters.serviceName,
        taskDefinition: taskDefinitionArn,
        desiredCount: 1
      })
    );
    serviceArn = response.service?.serviceArn;
  } else {
    logger.update('Creating ECS service');
    const response = await getEcsClient().send(
      new CreateServiceCommand(buildCreateServiceInput(parameters, taskDefinitionArn, registryArn))
    );
    serviceArn = response.service?.serviceArn;
  }
  if (!serviceArn) throw new Error(`Failed to deploy ECS service ${parameters.serviceName}`);
  return { serviceArn, taskDefinitionArn };
};

export const deleteEcsService = async (logger: OperationLogLine, parameters: EcsServiceParameters): Promise<void> => {
  logger.update('Deleting ECS service');

  const { clusterName, serviceName } = parameters;

  try {
    await getEcsClient().send(new UpdateServiceCommand({ cluster: clusterName, service: serviceName, desiredCount: 0 }));
    await getEcsClient().send(new DeleteServiceCommand({ cluster: clusterName, service: serviceName, force: true }));
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : undefined;
    if (name === 'ServiceNotFoundException' || name === 'ServiceNotActiveException') {
      return;
    }
    throw error;
  }

  logger.update('Waiting for ECS service tasks to stop');

  // The service stays draining until its tasks stop; only then can the cluster and its Cloud Map service go.
  await waitUntilServicesInactive({ ...getAwsClientWaiter(), client: getEcsClient() }, { cluster: clusterName, services: [serviceName] });
};
