import type { OperationLogLine } from '@ez4/aws-common';
import type { EcrRepositoryParameters } from './types';

import {
  ECRClient,
  CreateRepositoryCommand,
  DeleteRepositoryCommand,
  DescribeRepositoriesCommand,
  DescribeImagesCommand,
  GetAuthorizationTokenCommand,
  PutImageScanningConfigurationCommand,
  PutLifecyclePolicyCommand,
  RepositoryNotFoundException,
  ImageNotFoundException
} from '@aws-sdk/client-ecr';

import { getAwsClientOptions } from '@ez4/aws-common';

let clientInstance: ECRClient | null = null;

export const getEcrClient = () => {
  if (!clientInstance) {
    clientInstance = new ECRClient(getAwsClientOptions());
  }
  return clientInstance;
};

export const setEcrClient = (client: ECRClient | null) => {
  clientInstance = client;
};

export const findRepository = async (logger: OperationLogLine, repositoryName: string) => {
  logger.update('Checking repository');

  try {
    const response = await getEcrClient().send(
      new DescribeRepositoriesCommand({
        repositoryNames: [repositoryName]
      })
    );

    const repo = response.repositories?.[0];

    if (repo && repo.repositoryArn && repo.repositoryUri) {
      return {
        repositoryName,
        repositoryArn: repo.repositoryArn,
        repositoryUri: repo.repositoryUri
      };
    }

    return null;
  } catch (error) {
    if (error instanceof RepositoryNotFoundException) {
      return null;
    }
    throw error;
  }
};

export const createRepository = async (logger: OperationLogLine, parameters: EcrRepositoryParameters) => {
  logger.update('Creating repository');

  const { repositoryName, imageTagMutability, scanOnPush, lifecyclePolicyText } = parameters;

  const response = await getEcrClient().send(
    new CreateRepositoryCommand({
      repositoryName,
      imageTagMutability: imageTagMutability ?? 'IMMUTABLE',
      imageScanningConfiguration: {
        scanOnPush: scanOnPush ?? true
      }
    })
  );

  const repository = response.repository;

  if (!repository?.repositoryArn || !repository?.repositoryUri) {
    throw new Error(`Failed to create repository ${repositoryName}`);
  }

  if (lifecyclePolicyText) {
    await setLifecyclePolicy(logger, repositoryName, lifecyclePolicyText);
  }

  return {
    repositoryName,
    repositoryArn: repository.repositoryArn,
    repositoryUri: repository.repositoryUri
  };
};

export const deleteRepository = async (logger: OperationLogLine, repositoryName: string) => {
  logger.update('Deleting repository');

  try {
    await getEcrClient().send(
      new DeleteRepositoryCommand({
        repositoryName,
        force: true
      })
    );
  } catch (error) {
    if (!(error instanceof RepositoryNotFoundException)) {
      throw error;
    }
  }
};

export const updateScanningConfiguration = async (logger: OperationLogLine, repositoryName: string, scanOnPush: boolean) => {
  logger.update('Updating scanning configuration');

  await getEcrClient().send(
    new PutImageScanningConfigurationCommand({
      repositoryName,
      imageScanningConfiguration: {
        scanOnPush
      }
    })
  );
};

export const setLifecyclePolicy = async (logger: OperationLogLine, repositoryName: string, lifecyclePolicyText: string) => {
  logger.update('Updating lifecycle policy');

  await getEcrClient().send(
    new PutLifecyclePolicyCommand({
      repositoryName,
      lifecyclePolicyText
    })
  );
};

export const checkImageExists = async (repositoryName: string, imageTag: string): Promise<boolean> => {
  try {
    const response = await getEcrClient().send(
      new DescribeImagesCommand({
        repositoryName,
        imageIds: [{ imageTag }]
      })
    );

    return !!response.imageDetails?.length;
  } catch (error) {
    if (error instanceof ImageNotFoundException || error instanceof RepositoryNotFoundException) {
      return false;
    }
    throw error;
  }
};

export const fetchAuthorizationToken = async () => {
  const response = await getEcrClient().send(new GetAuthorizationTokenCommand({}));
  const authData = response.authorizationData?.[0];

  return {
    authorizationToken: authData?.authorizationToken,
    proxyEndpoint: authData?.proxyEndpoint
  };
};
