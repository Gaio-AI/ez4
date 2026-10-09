import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { HttpService } from '@ez4/gateway/library';
import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual, ok } from 'node:assert/strict';

import { isStageState } from '@ez4/aws-gateway';

import { prepareHttpServices } from '../src/triggers/http/service';

const options = {
  prefix: 'ez4',
  projectName: 'throttling',
  branchName: ''
} as DeployOptions;

const context = {
  setServiceState: () => {}
} as unknown as EventContext;

const getService = (attributes: Partial<HttpService>) => {
  return {
    type: '@ez4/http',
    name: 'ThrottlingApi',
    context: {},
    variables: {},
    services: {},
    routes: [],
    ...attributes
  } as HttpService;
};

const getStageParameters = (service: HttpService) => {
  const state: EntryStates = {};

  prepareHttpServices({ state, service, metadata: {}, options, context });

  const [stageState] = Object.values(state).filter((entry) => entry && isStageState(entry));

  ok(stageState && isStageState(stageState));

  return stageState.parameters;
};

describe('http service throttling', () => {
  it('assert :: a declared throttling goes to the stage', () => {
    const parameters = getStageParameters(getService({ throttling: { rateLimit: 10, burstLimit: 5 } }));

    deepEqual(parameters.throttling, { rateLimit: 10, burstLimit: 5 });
  });

  it('assert :: a service without throttling leaves the stage parameters as they were', () => {
    // Any new key, even an undefined one, would show up as a change in the plan of existing stages.
    deepEqual(getStageParameters(getService({})), { autoDeploy: true });
  });
});
