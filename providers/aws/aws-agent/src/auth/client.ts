import type { ResourceTags, OperationLogLine } from '@ez4/aws-common';
import type { ProviderCredentialResult } from './types';

import {
  CreateSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-secrets-manager';
import { getSecretsManagerClient } from '../proxy/client';

const isNotFound = (error: unknown): boolean => {
  if (error instanceof ResourceNotFoundException) {
    return true;
  }
  if (error && typeof error === 'object' && 'name' in error) {
    return error.name === 'ResourceNotFoundException';
  }
  return false;
};

const isResourceExists = (error: unknown): boolean => {
  if (error && typeof error === 'object' && 'name' in error) {
    return error.name === 'ResourceExistsException';
  }
  return false;
};

export const findProviderSecret = async (secretName: string, logger?: OperationLogLine): Promise<ProviderCredentialResult | undefined> => {
  logger?.update('Checking Secrets Manager provider credential');

  try {
    const client = getSecretsManagerClient();
    const result = await client.send(
      new DescribeSecretCommand({
        SecretId: secretName
      })
    );

    if (result.ARN) {
      return {
        secretArn: result.ARN
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

export const storeProviderSecret = async (
  secretName: string,
  value: Record<string, string>,
  tags?: ResourceTags,
  logger?: OperationLogLine
): Promise<ProviderCredentialResult> => {
  logger?.update('Storing Secrets Manager provider credential');

  const client = getSecretsManagerClient();
  const secretString = JSON.stringify(value);

  try {
    const result = await client.send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: secretString,
        Tags: tags ? Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) : undefined
      })
    );

    return {
      secretArn: result.ARN!
    };
  } catch (error) {
    if (isResourceExists(error)) {
      const updateResult = await client.send(
        new PutSecretValueCommand({
          SecretId: secretName,
          SecretString: secretString
        })
      );

      return {
        secretArn: updateResult.ARN!
      };
    }
    throw error;
  }
};
