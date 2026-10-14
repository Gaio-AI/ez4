import type { OperationLogLine, ResourceTags } from '@ez4/aws-common';
import type { Tag } from '@aws-sdk/client-ecs';
import type { EcsClusterParameters, EcsClusterResult } from './types';

import {
  ECSClient,
  CreateClusterCommand,
  DeleteClusterCommand,
  DescribeClustersCommand,
  ClusterNotFoundException
} from '@aws-sdk/client-ecs';

import { getAwsClientOptions } from '@ez4/aws-common';

let clientInstance: ECSClient | null = null;

export const getEcsClient = () => {
  if (!clientInstance) {
    clientInstance = new ECSClient(getAwsClientOptions());
  }
  return clientInstance;
};

export const setEcsClient = (client: ECSClient | null) => {
  clientInstance = client;
};

export const getEcsTagList = (tags: ResourceTags): Tag[] => {
  return Object.entries(tags).map(([key, value]) => ({
    key,
    value
  }));
};

export const findCluster = async (
  logger: OperationLogLine,
  clusterName: string
): Promise<EcsClusterResult | null> => {
  logger.update('Checking ECS cluster');

  try {
    const response = await getEcsClient().send(
      new DescribeClustersCommand({
        clusters: [clusterName]
      })
    );

    const cluster = response.clusters?.find(
      (c) => c.clusterName === clusterName && c.status !== 'INACTIVE'
    );

    if (cluster && cluster.clusterArn && cluster.clusterName) {
      return {
        clusterName: cluster.clusterName,
        clusterArn: cluster.clusterArn
      };
    }

    return null;
  } catch (error) {
    if (error instanceof ClusterNotFoundException) {
      return null;
    }
    throw error;
  }
};

export const createCluster = async (
  logger: OperationLogLine,
  parameters: EcsClusterParameters
): Promise<EcsClusterResult> => {
  logger.update('Creating ECS cluster');

  const { clusterName, tags } = parameters;

  const response = await getEcsClient().send(
    new CreateClusterCommand({
      clusterName,
      tags: tags ? getEcsTagList(tags) : undefined
    })
  );

  const cluster = response.cluster;

  if (!cluster?.clusterArn || !cluster?.clusterName) {
    throw new Error(`Failed to create ECS cluster ${clusterName}`);
  }

  return {
    clusterName: cluster.clusterName,
    clusterArn: cluster.clusterArn
  };
};

export const deleteCluster = async (
  logger: OperationLogLine,
  clusterName: string
): Promise<void> => {
  logger.update('Deleting ECS cluster');

  try {
    await getEcsClient().send(
      new DeleteClusterCommand({
        cluster: clusterName
      })
    );
  } catch (error) {
    if (!(error instanceof ClusterNotFoundException)) {
      throw error;
    }
  }
};
