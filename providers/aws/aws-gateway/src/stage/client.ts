import type { Arn, OperationLogLine } from '@ez4/aws-common';
import type { Variables } from '../types/variables';

import {
  GetStageCommand,
  CreateStageCommand,
  UpdateStageCommand,
  DeleteStageCommand,
  DeleteAccessLogSettingsCommand,
  NotFoundException
} from '@aws-sdk/client-apigatewayv2';

import { GetAccountCommand } from '@aws-sdk/client-api-gateway';
import { isAnyNumber } from '@ez4/utils';

import { getApiGatewayClient, getApiGatewayV2Client } from '../utils/deploy';
import { ThrottlingResetError } from './errors';
import { getAccessLogFormat } from './helpers/access-log';
import { assertVariables } from './helpers/variables';
import { StageServiceName } from './types';

export type StageThrottling = {
  rateLimit: number;
  burstLimit: number;
};

export type CreateRequest = {
  stageName: string;
  stageVariables?: Variables;
  throttling?: StageThrottling;
  autoDeploy?: boolean;
};

export type ImportOrCreateResponse = {
  stageName: string;
};

export type ImportResponse = ImportOrCreateResponse & {
  throttling?: StageThrottling;
};

export const importStage = async (logger: OperationLogLine, apiId: string, stageName: string): Promise<ImportResponse | undefined> => {
  logger.update(`Importing API stage`);

  try {
    const response = await getApiGatewayV2Client().send(
      new GetStageCommand({
        ApiId: apiId,
        StageName: stageName
      })
    );

    const rateLimit = response.DefaultRouteSettings?.ThrottlingRateLimit;
    const burstLimit = response.DefaultRouteSettings?.ThrottlingBurstLimit;

    return {
      stageName: response.StageName!,
      ...(isAnyNumber(rateLimit) &&
        isAnyNumber(burstLimit) && {
          throttling: {
            rateLimit,
            burstLimit
          }
        })
    };
  } catch (error) {
    if (!(error instanceof NotFoundException)) {
      throw error;
    }

    return undefined;
  }
};

export const createStage = async (logger: OperationLogLine, apiId: string, request: CreateRequest): Promise<ImportOrCreateResponse> => {
  logger.update(`Creating API stage`);

  const { stageName, stageVariables, throttling, autoDeploy } = request;

  if (stageVariables) {
    assertVariables(StageServiceName, stageVariables);
  }

  const response = await getApiGatewayV2Client().send(
    new CreateStageCommand({
      ApiId: apiId,
      StageName: stageName,
      StageVariables: stageVariables,
      AutoDeploy: autoDeploy,
      ...(throttling && {
        DefaultRouteSettings: getRouteSettings(throttling)
      })
    })
  );

  return {
    stageName: response.StageName!
  };
};

export const updateStage = async (logger: OperationLogLine, apiId: string, stageName: string, request: Partial<CreateRequest>) => {
  logger.update(`Updating API stage`);

  const { stageVariables, autoDeploy } = request;

  if (stageVariables) {
    assertVariables(StageServiceName, stageVariables);
  }

  await getApiGatewayV2Client().send(
    new UpdateStageCommand({
      ApiId: apiId,
      StageName: stageName,
      StageVariables: stageVariables,
      AutoDeploy: autoDeploy
    })
  );
};

export const updateThrottling = async (logger: OperationLogLine, apiId: string, stageName: string, throttling: StageThrottling) => {
  logger.update(`Updating API stage throttling`);

  await sendThrottling(apiId, stageName, throttling);
};

/**
 * The API has no call that takes a stage's throttling away, and a zero limit rejects every request. The
 * account limits bind every stage anyway, so a stage that gets them as its own has no limit of its own.
 */
export const resetThrottling = async (logger: OperationLogLine, apiId: string, stageName: string) => {
  logger.update(`Resetting API stage throttling`);

  await sendThrottling(apiId, stageName, await getAccountThrottling(stageName));
};

const getAccountThrottling = async (stageName: string): Promise<StageThrottling> => {
  const { throttleSettings } = await getApiGatewayClient()
    .send(new GetAccountCommand({}))
    .catch((error) => {
      throw new ThrottlingResetError(stageName, `reading them failed: ${error instanceof Error ? error.message : error}`, error);
    });

  const rateLimit = throttleSettings?.rateLimit;
  const burstLimit = throttleSettings?.burstLimit;

  if (!rateLimit || !burstLimit) {
    throw new ThrottlingResetError(stageName, `the account returned none`);
  }

  return {
    rateLimit,
    burstLimit
  };
};

const sendThrottling = async (apiId: string, stageName: string, throttling: StageThrottling) => {
  await getApiGatewayV2Client().send(
    new UpdateStageCommand({
      ApiId: apiId,
      StageName: stageName,
      DefaultRouteSettings: getRouteSettings(throttling)
    })
  );
};

export const enableAccessLogs = async (logger: OperationLogLine, apiId: string, stageName: string, logGroupArn: Arn) => {
  logger.update(`Enabling API access logs`);

  await getApiGatewayV2Client().send(
    new UpdateStageCommand({
      ApiId: apiId,
      StageName: stageName,
      AccessLogSettings: {
        DestinationArn: logGroupArn,
        Format: getAccessLogFormat()
      }
    })
  );
};

export const disableAccessLogs = async (logger: OperationLogLine, apiId: string, stageName: string) => {
  logger.update(`Disabling API access logs`);

  await getApiGatewayV2Client().send(
    new DeleteAccessLogSettingsCommand({
      ApiId: apiId,
      StageName: stageName
    })
  );
};

export const deleteStage = async (logger: OperationLogLine, apiId: string, stageName: string) => {
  logger.update(`Deleting API stage`);

  try {
    await getApiGatewayV2Client().send(
      new DeleteStageCommand({
        ApiId: apiId,
        StageName: stageName
      })
    );

    return true;
  } catch (error) {
    if (!(error instanceof NotFoundException)) {
      throw error;
    }

    return false;
  }
};

const getRouteSettings = (throttling: StageThrottling) => {
  return {
    ThrottlingRateLimit: throttling.rateLimit,
    ThrottlingBurstLimit: throttling.burstLimit
  };
};
