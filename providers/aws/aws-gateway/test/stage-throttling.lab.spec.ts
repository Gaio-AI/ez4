import type { EntryState, EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { GetStageCommand } from '@aws-sdk/client-apigatewayv2';
import { GetAccountCommand } from '@aws-sdk/client-api-gateway';
import { createGateway, createStage, GatewayProtocol, isStageState, registerTriggers } from '@ez4/aws-gateway';
import { deploy } from '@ez4/aws-common';
import { deepClone } from '@ez4/utils';

import { getApiGatewayClient, getApiGatewayV2Client } from '../src/utils/deploy';

const assertDeploy = async <E extends EntryState>(newState: EntryStates<E>, oldState: EntryStates<E> | undefined) => {
  const { result: state, errors } = await deploy(newState, oldState);

  equal(errors.length, 0, errors.map((error) => error.message).join('\n'));

  return state;
};

const getStageThrottling = async (state: EntryStates, stageId: string) => {
  const stageState = state[stageId];

  ok(stageState && isStageState(stageState) && stageState.result);

  const { apiId, stageName } = stageState.result;

  const { DefaultRouteSettings } = await getApiGatewayV2Client().send(
    new GetStageCommand({
      ApiId: apiId,
      StageName: stageName
    })
  );

  return {
    rateLimit: DefaultRouteSettings?.ThrottlingRateLimit,
    burstLimit: DefaultRouteSettings?.ThrottlingBurstLimit
  };
};

const getAccountThrottling = async () => {
  const { throttleSettings } = await getApiGatewayClient().send(new GetAccountCommand({}));

  ok(throttleSettings?.rateLimit && throttleSettings.burstLimit);

  return {
    rateLimit: throttleSettings.rateLimit,
    burstLimit: throttleSettings.burstLimit
  };
};

// Deploys the candidate as if the stage were not in the state yet, so the existing stage is imported.
const getImportStates = (lastState: EntryStates, stageId: string) => {
  const oldState = deepClone(lastState);
  const newState = deepClone(lastState);

  delete oldState[stageId];

  const resource = newState[stageId];

  ok(resource && isStageState(resource));

  delete resource.result;

  return { newState, oldState, resource };
};

describe('gateway stage throttling', { timeout: 120000 }, () => {
  let lastState: EntryStates | undefined;
  let stageId: string | undefined;

  registerTriggers();

  it('assert :: deploy with throttling', async () => {
    const localState: EntryStates = {};

    const gatewayResource = createGateway(localState, {
      gatewayId: 'ez4-test-gateway-throttling',
      gatewayName: 'EZ4: Test gateway for stage throttling',
      protocol: GatewayProtocol.Http
    });

    const resource = createStage(localState, gatewayResource, undefined, {
      autoDeploy: true,
      throttling: {
        rateLimit: 1,
        burstLimit: 1
      }
    });

    stageId = resource.entryId;
    lastState = await assertDeploy(localState, undefined);

    deepEqual(await getStageThrottling(lastState, stageId), { rateLimit: 1, burstLimit: 1 });
  });

  it('assert :: update throttling', async () => {
    ok(stageId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[stageId];

    ok(resource && isStageState(resource));

    resource.parameters.throttling = {
      rateLimit: 2,
      burstLimit: 3
    };

    lastState = await assertDeploy(localState, lastState);

    deepEqual(await getStageThrottling(lastState, stageId), { rateLimit: 2, burstLimit: 3 });
  });

  it('assert :: removing throttling leaves the account limits', async () => {
    ok(stageId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[stageId];

    ok(resource && isStageState(resource));

    delete resource.parameters.throttling;

    lastState = await assertDeploy(localState, lastState);

    deepEqual(await getStageThrottling(lastState, stageId), await getAccountThrottling());
  });

  it('assert :: importing a stage applies the declared throttling', async () => {
    ok(stageId && lastState);

    const { newState, oldState, resource } = getImportStates(lastState, stageId);

    resource.parameters.throttling = {
      rateLimit: 4,
      burstLimit: 5
    };

    lastState = await assertDeploy(newState, oldState);

    deepEqual(await getStageThrottling(lastState, stageId), { rateLimit: 4, burstLimit: 5 });
  });

  it('assert :: importing a throttled stage without throttling leaves the account limits', async () => {
    ok(stageId && lastState);

    const { newState, oldState, resource } = getImportStates(lastState, stageId);

    delete resource.parameters.throttling;

    lastState = await assertDeploy(newState, oldState);

    deepEqual(await getStageThrottling(lastState, stageId), await getAccountThrottling());
  });

  it('assert :: destroy', async () => {
    ok(stageId && lastState);

    const { result } = await deploy(undefined, lastState);

    equal(result[stageId], undefined);
  });
});
