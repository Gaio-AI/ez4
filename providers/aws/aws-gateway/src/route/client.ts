import type { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import type { Arn, OperationLogLine } from '@ez4/aws-common';

import {
  GetRoutesCommand,
  GetStagesCommand,
  CreateRouteCommand,
  UpdateRouteCommand,
  DeleteRouteCommand,
  AuthorizationType,
  NotFoundException
} from '@aws-sdk/client-apigatewayv2';

import { setTimeout } from 'node:timers/promises';

import { waitCreation, waitDeletion } from '@ez4/aws-common';
import { Logger } from '@ez4/logger';
import { getApiGatewayV2Client } from '../utils/deploy';

/**
 * How a route moved to another integration waits for its stages (in milliseconds).
 */
export const StageDeploymentWait = {
  // Every route moving at once polls, so the interval keeps the control plane calls of a large move low.
  pollInterval: 2000,
  timeout: 60000,

  // A stage that already serves its new deployment still sends some requests to the prior
  // integration for a few seconds, and deleting what that integration invokes fails them.
  settleTime: 20000
};

export type CreateRequest = {
  routePath: string;
  integrationId: string;
  operationName?: string;
  authorizerId?: string;
};

export type ImportOrCreateResponse = {
  routeId: string;
  routeArn: Arn;
};

export type UpdateRequest = Partial<CreateRequest>;

export const importRoute = async (
  logger: OperationLogLine,
  apiId: string,
  routePath: string
): Promise<ImportOrCreateResponse | undefined> => {
  logger.update(`Importing route`);

  const client = getApiGatewayV2Client();

  const response = await client.send(
    new GetRoutesCommand({
      ApiId: apiId,
      MaxResults: '300'
    })
  );

  const route = response.Items?.find((route) => route.RouteKey === routePath);

  if (!route) {
    return undefined;
  }

  const routeId = route.RouteId!;
  const routeArn = await getRouteArn(client, apiId, routeId);

  return {
    routeArn,
    routeId
  };
};

export const createRoute = async (logger: OperationLogLine, apiId: string, request: CreateRequest): Promise<ImportOrCreateResponse> => {
  logger.update(`Creating route`);

  const { integrationId, authorizerId, operationName, routePath } = request;

  const client = getApiGatewayV2Client();

  // If multiple routes are created at the same time, a conflict error occurs.
  // The `waitCreation` will keep retrying until max attempts.
  const response = await waitCreation(() => {
    return client.send(
      new CreateRouteCommand({
        ApiId: apiId,
        RouteKey: routePath,
        OperationName: operationName,
        Target: `integrations/${integrationId}`,
        ...(authorizerId && {
          AuthorizationType: AuthorizationType.CUSTOM,
          AuthorizerId: authorizerId
        })
      })
    );
  });

  const routeId = response.RouteId!;
  const routeArn = await getRouteArn(client, apiId, routeId);

  return {
    routeArn,
    routeId
  };
};

export const updateRoute = async (logger: OperationLogLine, apiId: string, routeId: string, request: UpdateRequest) => {
  logger.update(`Update route`);

  const { integrationId, authorizerId, operationName, routePath } = request;

  const authorizationType = authorizerId ? AuthorizationType.CUSTOM : AuthorizationType.NONE;

  await getApiGatewayV2Client().send(
    new UpdateRouteCommand({
      ApiId: apiId,
      RouteId: routeId,
      RouteKey: routePath,
      OperationName: operationName,
      AuthorizationType: authorizationType,
      AuthorizerId: authorizerId,
      ...(integrationId && {
        Target: `integrations/${integrationId}`
      })
    })
  );
};

/**
 * The deployment each auto deployed stage of the API serves, by stage name.
 */
export const getStageDeployments = async (apiId: string) => {
  const response = await getApiGatewayV2Client().send(
    new GetStagesCommand({
      ApiId: apiId
    })
  );

  const deployments: Record<string, string | undefined> = {};

  for (const { StageName, AutoDeploy, DeploymentId } of response.Items ?? []) {
    if (StageName && AutoDeploy) {
      deployments[StageName] = DeploymentId;
    }
  }

  return deployments;
};

/**
 * Wait until every auto deployed stage serves a deployment newer than the given ones, and then for the
 * stage to settle, so the resources the route used before can be deleted. A stage that doesn't deploy in
 * time only gives up the wait: the route itself is already updated.
 */
export const waitStageDeployment = async (
  logger: OperationLogLine,
  apiId: string,
  priorDeployments: Record<string, string | undefined>
) => {
  const stageNames = Object.keys(priorDeployments);

  if (!stageNames.length) {
    return;
  }

  logger.update(`Waiting for stage deployment`);

  const { pollInterval, timeout, settleTime } = StageDeploymentWait;

  const deadline = Date.now() + timeout;

  let deployed = false;

  while (!deployed && Date.now() < deadline) {
    const deployments = await getStageDeployments(apiId);

    deployed = stageNames.every((stageName) => deployments[stageName] !== priorDeployments[stageName]);

    if (!deployed) {
      await setTimeout(pollInterval);
    }
  }

  if (!deployed) {
    Logger.warn(`API ${apiId}: stages didn't deploy the route change in ${timeout / 1000}s; deleting its prior integration anyway.`);
  }

  await setTimeout(settleTime);
};

export const deleteRoute = async (logger: OperationLogLine, apiId: string, routeId: string) => {
  logger.update(`Deleting route`);

  const client = getApiGatewayV2Client();

  // If the multiple routes being deleted triggers the conflict error,
  // keep retrying until max attempts.
  await waitDeletion(async () => {
    try {
      await client.send(
        new DeleteRouteCommand({
          ApiId: apiId,
          RouteId: routeId
        })
      );
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }
  });
};

const getRouteArn = async (client: ApiGatewayV2Client, apiId: string, routeId: string) => {
  const region = await client.config.region();

  return `arn:aws:apigateway:${region}::/apis/${apiId}/routes/${routeId}` as Arn;
};
