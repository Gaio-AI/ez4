import type { OperationLogLine } from '@ez4/aws-common';
import type { AgentNamespaceParameters, AgentNamespaceResult } from './types';

import {
  ServiceDiscoveryClient,
  CreatePrivateDnsNamespaceCommand,
  DeleteNamespaceCommand,
  DeleteServiceCommand,
  CreateServiceCommand,
  GetNamespaceCommand,
  GetOperationCommand,
  ListNamespacesCommand,
  ListServicesCommand,
  NamespaceNotFound,
  ServiceNotFound
} from '@aws-sdk/client-servicediscovery';

import { getAwsClientOptions } from '@ez4/aws-common';

let clientInstance: ServiceDiscoveryClient | null = null;

export const getServiceDiscoveryClient = () => {
  if (!clientInstance) {
    clientInstance = new ServiceDiscoveryClient(getAwsClientOptions());
  }
  return clientInstance;
};

export const setServiceDiscoveryClient = (client: ServiceDiscoveryClient | null) => {
  clientInstance = client;
};

const defaultSleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

export const waitForOperation = async (
  operationId: string,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<string | undefined> => {
  for (let i = 0; i < 60; i++) {
    const response = await getServiceDiscoveryClient().send(new GetOperationCommand({ OperationId: operationId }));

    const operation = response.Operation;

    if (operation?.Status === 'SUCCESS') {
      return operation.Targets?.NAMESPACE;
    }

    if (operation?.Status === 'FAIL') {
      throw new Error(operation.ErrorMessage ?? 'Operation failed');
    }

    await sleep(5000);
  }

  throw new Error(`Operation ${operationId} timed out`);
};

export const findNamespace = async (name: string): Promise<{ Id: string; Arn: string } | null> => {
  const response = await getServiceDiscoveryClient().send(
    new ListNamespacesCommand({
      Filters: [{ Name: 'NAME', Values: [name], Condition: 'EQ' }]
    })
  );

  const first = response.Namespaces?.[0];
  if (first?.Id && first?.Arn) {
    return {
      Id: first.Id,
      Arn: first.Arn
    };
  }

  return null;
};

export const createAgentNamespaceResource = async (
  logger: OperationLogLine,
  parameters: AgentNamespaceParameters,
  sleep?: (ms: number) => Promise<void>
): Promise<AgentNamespaceResult> => {
  logger.update('Checking Cloud Map namespace');

  const existing = await findNamespace(parameters.namespaceName);

  let namespaceId: string;
  let namespaceArn: string;

  if (existing) {
    namespaceId = existing.Id;
    namespaceArn = existing.Arn;
  } else {
    logger.update('Creating Cloud Map namespace');

    const tags = parameters.tags ? Object.entries(parameters.tags).map(([Key, Value]) => ({ Key, Value })) : undefined;

    const createNsResponse = await getServiceDiscoveryClient().send(
      new CreatePrivateDnsNamespaceCommand({
        Name: parameters.namespaceName,
        Vpc: parameters.vpcId,
        Tags: tags
      })
    );

    const operationId = createNsResponse.OperationId;
    if (!operationId) {
      throw new Error(`Failed to create private DNS namespace ${parameters.namespaceName}: no operation ID returned`);
    }

    const targetNamespaceId = await waitForOperation(operationId, sleep);
    if (!targetNamespaceId) {
      throw new Error(`Failed to obtain namespace ID for ${parameters.namespaceName}`);
    }

    namespaceId = targetNamespaceId;

    const nsResponse = await getServiceDiscoveryClient().send(new GetNamespaceCommand({ Id: namespaceId }));

    if (!nsResponse.Namespace?.Arn) {
      throw new Error(`Failed to obtain ARN for namespace ${namespaceId}`);
    }

    namespaceArn = nsResponse.Namespace.Arn;
  }

  logger.update('Checking Cloud Map discovery service');

  const listServicesResponse = await getServiceDiscoveryClient().send(
    new ListServicesCommand({
      Filters: [{ Name: 'NAMESPACE_ID', Values: [namespaceId], Condition: 'EQ' }]
    })
  );

  const existingService = listServicesResponse.Services?.find((s) => s.Name === parameters.serviceName);

  let discoveryServiceId: string;
  let discoveryServiceArn: string;

  if (existingService?.Id && existingService?.Arn) {
    discoveryServiceId = existingService.Id;
    discoveryServiceArn = existingService.Arn;
  } else {
    logger.update('Creating Cloud Map discovery service');

    const createServiceResponse = await getServiceDiscoveryClient().send(
      new CreateServiceCommand({
        Name: parameters.serviceName,
        NamespaceId: namespaceId,
        DnsConfig: {
          RoutingPolicy: 'MULTIVALUE',
          DnsRecords: [{ Type: 'A', TTL: 10 }]
        },
        HealthCheckCustomConfig: {
          FailureThreshold: 1
        }
      })
    );

    if (!createServiceResponse.Service?.Id || !createServiceResponse.Service?.Arn) {
      throw new Error(`Failed to create discovery service ${parameters.serviceName}`);
    }

    discoveryServiceId = createServiceResponse.Service.Id;
    discoveryServiceArn = createServiceResponse.Service.Arn;
  }

  return {
    namespaceId,
    namespaceArn,
    discoveryServiceId,
    discoveryServiceArn
  };
};

export const deleteAgentNamespaceResource = async (
  logger: OperationLogLine,
  result: AgentNamespaceResult,
  sleep?: (ms: number) => Promise<void>
): Promise<void> => {
  logger.update('Deleting Cloud Map discovery service');

  try {
    await getServiceDiscoveryClient().send(
      new DeleteServiceCommand({
        Id: result.discoveryServiceId
      })
    );
  } catch (error: unknown) {
    const isServiceNotFound = error instanceof ServiceNotFound || (error instanceof Error && error.name === 'ServiceNotFound');
    if (!isServiceNotFound) {
      throw error;
    }
  }

  logger.update('Deleting Cloud Map namespace');

  try {
    const response = await getServiceDiscoveryClient().send(
      new DeleteNamespaceCommand({
        Id: result.namespaceId
      })
    );

    if (response.OperationId) {
      await waitForOperation(response.OperationId, sleep);
    }
  } catch (error: unknown) {
    const isNamespaceNotFound = error instanceof NamespaceNotFound || (error instanceof Error && error.name === 'NamespaceNotFound');
    if (!isNamespaceNotFound) {
      throw error;
    }
  }
};
