import type { DescribeSecretCommandOutput } from '@aws-sdk/client-secrets-manager';
import type { OperationLogLine, ResourceTags } from '@ez4/aws-common';
import type { SecretParameters, SecretResult } from './types';

import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-secrets-manager';
import { getAwsClientOptions } from '@ez4/aws-common';

let clientInstance: SecretsManagerClient | null = null;

export const getSecretsManagerClient = () => {
  if (!clientInstance) {
    clientInstance = new SecretsManagerClient(getAwsClientOptions());
  }
  return clientInstance;
};

export const setSecretsManagerClient = (client: SecretsManagerClient | null) => {
  clientInstance = client;
};

const isNotFound = (error: unknown): boolean => {
  if (error instanceof ResourceNotFoundException) {
    return true;
  }
  if (error && typeof error === 'object' && 'name' in error) {
    return error.name === 'ResourceNotFoundException';
  }
  return false;
};

export const findSecret = async (secretName: string, logger?: OperationLogLine): Promise<SecretResult | undefined> => {
  logger?.update('Checking Secrets Manager secret');

  try {
    const response: DescribeSecretCommandOutput = await getSecretsManagerClient().send(
      new DescribeSecretCommand({
        SecretId: secretName
      })
    );

    if (response.ARN) {
      return {
        secretArn: response.ARN
      };
    }

    return undefined;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
};

export const putSecretValue = async (
  secretName: string,
  value: Record<string, string> | string,
  tags?: ResourceTags,
  logger?: OperationLogLine
): Promise<SecretResult> => {
  const secretString = typeof value === 'string' ? value : JSON.stringify(value);
  return createSecretResource(
    {
      secretName,
      getSecretValue: () => Promise.resolve(secretString),
      tags
    },
    logger
  );
};

const serializeSecretValue = async (parameters: SecretParameters): Promise<string | undefined> => {
  if (!parameters.getSecretValue) {
    return undefined;
  }
  const rawValue = await parameters.getSecretValue();
  if (typeof rawValue === 'string') {
    return rawValue;
  }
  return JSON.stringify(rawValue);
};

export const createSecretResource = async (parameters: SecretParameters, logger?: OperationLogLine): Promise<SecretResult> => {
  logger?.update('Creating Secrets Manager secret');

  const { secretName, description, tags } = parameters;
  const secretString = await serializeSecretValue(parameters);

  const existing = await findSecret(secretName);
  if (existing) {
    if (secretString !== undefined) {
      await getSecretsManagerClient().send(
        new PutSecretValueCommand({
          SecretId: secretName,
          SecretString: secretString
        })
      );
    }
    return existing;
  }

  const response = await getSecretsManagerClient().send(
    new CreateSecretCommand({
      Name: secretName,
      Description: description,
      SecretString: secretString,
      Tags: tags ? Object.entries(tags).map(([Key, Value]) => ({ Key, Value: String(Value) })) : undefined
    })
  );

  if (!response.ARN) {
    throw new Error(`Failed to create secret ${secretName}`);
  }

  return {
    secretArn: response.ARN
  };
};

export const deleteSecretResource = async (secretName: string, logger?: OperationLogLine): Promise<void> => {
  logger?.update('Deleting Secrets Manager secret');

  try {
    await getSecretsManagerClient().send(
      new DeleteSecretCommand({
        SecretId: secretName,
        ForceDeleteWithoutRecovery: true
      })
    );
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }
};
