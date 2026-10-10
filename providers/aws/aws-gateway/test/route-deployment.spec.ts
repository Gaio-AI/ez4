import type { StepContext } from '@ez4/state';
import type { RouteState } from '../src/route/types';

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { ApiGatewayV2Client, GetStagesCommand, UpdateRouteCommand } from '@aws-sdk/client-apigatewayv2';
import { Logger } from '@ez4/logger';

import { StageDeploymentWait } from '../src/route/client';
import { getRouteHandler } from '../src/route/handler';
import { IntegrationServiceType } from '../src/integration/types';

const getRouteState = (integrationId: string, authorizerId?: string): RouteState => ({
  type: 'aws:api.route',
  entryId: 'route-entry',
  dependencies: [],
  parameters: {
    routePath: 'GET /items'
  },
  result: {
    apiId: 'api-id',
    routeId: 'route-id',
    routeArn: 'arn:aws:apigateway:us-east-2::/apis/api-id/routes/route-id',
    integrationId,
    authorizerId
  }
});

const getContext = (integrationId: string, authorizerId?: string) => {
  return {
    getDependencies: (type: string) => {
      if (type === IntegrationServiceType) {
        return [{ result: { integrationId } }];
      }

      return authorizerId ? [{ result: { authorizerId } }] : [];
    }
  } as unknown as StepContext;
};

/**
 * Mocks the API: the auto deployed stage moves to a new deployment after the given number of reads.
 */
const mockApi = (readsBeforeDeployment: number) => {
  const commands: string[] = [];

  let stageReads = 0;

  mock.method(ApiGatewayV2Client.prototype, 'send', async (command: unknown) => {
    if (command instanceof GetStagesCommand) {
      const deploymentId = stageReads++ > readsBeforeDeployment ? 'new-deployment' : 'old-deployment';

      commands.push(`GetStages ${deploymentId}`);

      return {
        Items: [
          { StageName: '$default', AutoDeploy: true, DeploymentId: deploymentId },
          { StageName: 'manual', AutoDeploy: false, DeploymentId: 'manual-deployment' }
        ]
      };
    }

    if (command instanceof UpdateRouteCommand) {
      commands.push(`UpdateRoute ${command.input.Target}`);
    }

    return {};
  });

  return commands;
};

describe('gateway route update and the stage deployment', () => {
  const { pollInterval, timeout, settleTime } = StageDeploymentWait;

  beforeEach(() => {
    Object.assign(StageDeploymentWait, { pollInterval: 1, timeout: 1000, settleTime: 1 });
  });

  afterEach(() => {
    Object.assign(StageDeploymentWait, { pollInterval, timeout, settleTime });
    mock.restoreAll();
  });

  it('assert :: a route moved to another integration waits for the stage to deploy it', async () => {
    const commands = mockApi(2);

    await getRouteHandler().update(getRouteState('old-integration'), getRouteState('old-integration'), getContext('new-integration'));

    deepEqual(commands, [
      'GetStages old-deployment',
      'UpdateRoute integrations/new-integration',
      'GetStages old-deployment',
      'GetStages old-deployment',
      'GetStages new-deployment'
    ]);
  });

  it('assert :: a route kept on its integration does not wait', async () => {
    const commands = mockApi(0);

    await getRouteHandler().update(
      getRouteState('same-integration'),
      getRouteState('same-integration', 'old-authorizer'),
      getContext('same-integration', 'new-authorizer')
    );

    deepEqual(commands, ['UpdateRoute integrations/same-integration']);
  });

  it('assert :: a stage that never deploys holds the update only until the timeout', async () => {
    Object.assign(StageDeploymentWait, { timeout: 50 });

    const commands = mockApi(Infinity);
    const warn = mock.method(Logger, 'warn', () => {});

    await getRouteHandler().update(getRouteState('old-integration'), getRouteState('old-integration'), getContext('new-integration'));

    equal(commands[1], 'UpdateRoute integrations/new-integration');
    equal(commands.at(-1), 'GetStages old-deployment');
    equal(warn.mock.callCount(), 1);
  });
});
