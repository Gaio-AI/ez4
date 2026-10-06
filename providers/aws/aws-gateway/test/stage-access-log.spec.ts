import type { EntryState, EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { GetStageCommand } from '@aws-sdk/client-apigatewayv2';
import { createGateway, createStage, GatewayProtocol, isStageState, registerTriggers } from '@ez4/aws-gateway';
import { createLogGroup, isLogGroupState } from '@ez4/aws-logs';
import { deploy } from '@ez4/aws-common';

import { getApiGatewayV2Client } from '../src/utils/deploy';

const assertDeploy = async <E extends EntryState>(newState: EntryStates<E>, oldState: EntryStates<E> | undefined) => {
  const { result: state, errors } = await deploy(newState, oldState);

  equal(errors.length, 0, errors.map((error) => error.message).join('\n'));

  return state;
};

describe('gateway stage access log', { timeout: 120000 }, () => {
  let lastState: EntryStates | undefined;

  registerTriggers();

  it('assert :: deploy a new stage that logs its access', async () => {
    const localState: EntryStates = {};

    const gatewayResource = createGateway(localState, {
      gatewayId: 'ez4-test-gateway-access-log',
      gatewayName: 'EZ4: Test gateway for stage access logs',
      protocol: GatewayProtocol.Http
    });

    const logGroupResource = createLogGroup(localState, {
      groupName: 'ez4-test-gateway-access-log',
      retention: 1
    });

    const stageResource = createStage(localState, gatewayResource, logGroupResource, {
      autoDeploy: true
    });

    lastState = await assertDeploy(localState, undefined);

    const stageState = lastState[stageResource.entryId];
    const logGroupState = lastState[logGroupResource.entryId];

    ok(stageState && isStageState(stageState) && stageState.result);
    ok(logGroupState && isLogGroupState(logGroupState) && logGroupState.result);

    const { apiId, stageName } = stageState.result;

    const { AccessLogSettings } = await getApiGatewayV2Client().send(
      new GetStageCommand({
        ApiId: apiId,
        StageName: stageName
      })
    );

    equal(AccessLogSettings?.DestinationArn, logGroupState.result.groupArn);
  });

  it('assert :: destroy', async () => {
    ok(lastState);

    const { result } = await deploy(undefined, lastState);

    equal(Object.keys(result).length, 0);
  });
});
