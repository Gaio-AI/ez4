import type { DescribeSecretCommandOutput } from '@aws-sdk/client-secrets-manager';
import type { OperationLogLine } from '@ez4/aws-common';
import type { ProxyCredentialParameters, ProxyCredentialResult } from './types';

import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-secrets-manager';
import { getAwsClientOptions } from '@ez4/aws-common';
import { generateAgentPassword, generateHtpasswd } from './auth';

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

export const findProxySecret = async (logger: OperationLogLine, secretName: string): Promise<ProxyCredentialResult | null> => {
  logger.update('Checking Secrets Manager proxy credential');

  try {
    const response: DescribeSecretCommandOutput = await getSecretsManagerClient().send(
      new DescribeSecretCommand({
        SecretId: secretName
      })
    );

    if (response.ARN && response.Name) {
      return {
        secretName: response.Name,
        secretArn: response.ARN,
        agentName: response.Name
      };
    }

    return null;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
};

export const createProxySecret = async (
  logger: OperationLogLine,
  parameters: ProxyCredentialParameters
): Promise<ProxyCredentialResult> => {
  logger.update('Creating Secrets Manager proxy credential');

  const { secretName, agentName, tags } = parameters;
  const password = generateAgentPassword();

  const secretString = JSON.stringify({
    username: agentName,
    password,
    htpasswd: generateHtpasswd({ [agentName]: password }).trim()
  });

  const response = await getSecretsManagerClient().send(
    new CreateSecretCommand({
      Name: secretName,
      Description: `EZ4 egress proxy credentials for agent ${agentName}`,
      SecretString: secretString,
      Tags: tags ? Object.entries(tags).map(([Key, Value]) => ({ Key, Value: String(Value) })) : undefined
    })
  );

  if (!response.ARN || !response.Name) {
    throw new Error(`Failed to create secret ${secretName}`);
  }

  return {
    secretName: response.Name,
    secretArn: response.ARN,
    agentName
  };
};

export const deleteProxySecret = async (logger: OperationLogLine, secretName: string): Promise<void> => {
  logger.update('Deleting Secrets Manager proxy credential');

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
